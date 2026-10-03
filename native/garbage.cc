// Native core of Garbage App (C++ / N-API). Modes: 1 = fsutil, 2 = 4 GB chunked write, 3 = RAM.
#define NOMINMAX
#include <napi.h>
#include <windows.h>
#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <string>
#include <vector>

typedef unsigned long long u64;
static const u64 CHUNK = 4ULL << 30;  // 4 GB per write pass
static const u64 BUF = 1ULL << 20;    // 1 MB write buffer
static const u64 BLK = 64ULL << 20;   // 64 MB RAM blocks
static std::vector<void*> g_blocks;

static std::wstring W(const std::string& s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, 0, 0);
  std::wstring w(n ? n - 1 : 0, L'\0');
  if (n) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
  return w;
}

class Job : public Napi::AsyncProgressWorker<double> {
  int mode; std::wstring path; u64 total; Napi::FunctionReference prog;
 public:
  Job(Napi::Function done, Napi::Function p, int m, std::wstring pa, u64 t)
      : Napi::AsyncProgressWorker<double>(done), mode(m), path(pa), total(t) { prog = Napi::Persistent(p); }

  void Execute(const ExecutionProgress& ep) override {
    double last = -1;
    auto send = [&](u64 d) {
      double p = 100.0 * (double)d / (double)total;
      if (p - last >= 0.1 || d >= total) { last = p; ep.Send(&p, 1); }
    };

    if (mode == 3) {  // ---- waste memory
      MEMORYSTATUSEX ms; ms.dwLength = sizeof(ms); GlobalMemoryStatusEx(&ms);
      if (total > ms.ullAvailPhys) { SetError("Not enough free RAM. Available: " + std::to_string(ms.ullAvailPhys >> 20) + " MB"); return; }
      u64 d = 0;
      while (d < total) {
        u64 n = std::min(BLK, total - d);
        void* p = VirtualAlloc(0, (SIZE_T)n, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
        if (!p) { SetError("Windows refused the allocation."); return; }
        memset(p, 0xA5, (size_t)n);  // touch every page so it really uses RAM
        g_blocks.push_back(p); d += n; send(d);
      }
      return;
    }

    // ---- disk modes: check free space first
    std::wstring dir = path.substr(0, path.find_last_of(L'\\'));
    ULARGE_INTEGER avail;
    if (GetDiskFreeSpaceExW(dir.c_str(), &avail, 0, 0) && total > avail.QuadPart) {
      SetError("Not enough free disk space. Available: " + std::to_string(avail.QuadPart >> 20) + " MB"); return;
    }

    if (mode == 1) {  // ---- fsutil file createnew
      std::wstring cmd = L"fsutil file createnew \"" + path + L"\" " + std::to_wstring(total);
      STARTUPINFOW si; ZeroMemory(&si, sizeof(si)); si.cb = sizeof(si);
      PROCESS_INFORMATION pi; ZeroMemory(&pi, sizeof(pi));
      if (!CreateProcessW(0, &cmd[0], 0, 0, FALSE, CREATE_NO_WINDOW, 0, 0, &si, &pi)) { SetError("Could not start fsutil."); return; }
      while (WaitForSingleObject(pi.hProcess, 150) == WAIT_TIMEOUT) {
        WIN32_FILE_ATTRIBUTE_DATA a;
        if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &a)) send(((u64)a.nFileSizeHigh << 32) | a.nFileSizeLow);
      }
      DWORD code = 1; GetExitCodeProcess(pi.hProcess, &code);
      CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
      if (code) { SetError("fsutil failed (exit " + std::to_string(code) + "). The file may already exist, or the folder needs administrator rights."); return; }
      send(total);
      return;
    }

    // ---- mode 2: write in 4 GB parts
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
    if (h == INVALID_HANDLE_VALUE) { SetError("Cannot create the file. Check the folder and permissions."); return; }
    std::vector<char> buf((size_t)BUF, 0);
    u64 parts = total / CHUNK + (total % CHUNK ? 1 : 0), done = 0;
    for (u64 c = 0; c < parts; c++) {
      u64 cb = std::min(CHUNK, total - c * CHUNK), w = 0;
      while (w < cb) {
        DWORD n = (DWORD)std::min(BUF, cb - w), o = 0;
        if (!WriteFile(h, buf.data(), n, &o, 0) || o != n) { CloseHandle(h); SetError("Write failed (disk full?)."); return; }
        w += n; done += n; send(done);
      }
    }
    CloseHandle(h);
  }
  void OnOK() override { Callback().Call({Env().Null()}); }
  void OnError(const Napi::Error& e) override { Callback().Call({Napi::String::New(Env(), e.Message())}); }
  void OnProgress(const double* d, size_t n) override { if (n) prog.Call({Napi::Number::New(Env(), d[n - 1])}); }
};

// run(mode, path, bytesAsString, onProgress, onDone)
Napi::Value Run(const Napi::CallbackInfo& i) {
  int m = i[0].As<Napi::Number>().Int32Value();
  std::string path = i[1].As<Napi::String>(), b = i[2].As<Napi::String>();
  Napi::Function done = i[4].As<Napi::Function>();
  bool ok = !b.empty() && b.size() <= 20 && b.find_first_not_of("0123456789") == std::string::npos;
  errno = 0; u64 t = ok ? _strtoui64(b.c_str(), 0, 10) : 0;
  if (errno == ERANGE || !t) { done.Call({Napi::String::New(i.Env(), "Size must be between 1 byte and 16 EB.")}); return i.Env().Undefined(); }
  (new Job(done, i[3].As<Napi::Function>(), m, W(path), t))->Queue();
  return i.Env().Undefined();
}

Napi::Value Free(const Napi::CallbackInfo& i) {
  for (void* p : g_blocks) VirtualFree(p, 0, MEM_RELEASE);
  g_blocks.clear();
  return i.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("run", Napi::Function::New(env, Run));
  exports.Set("free", Napi::Function::New(env, Free));
  return exports;
}
NODE_API_MODULE(garbage, Init)
