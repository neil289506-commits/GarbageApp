{
  "targets": [{
    "target_name": "garbage",
    "sources": ["garbage.cc"],
    "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
    "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 0 } }
  }]
}
