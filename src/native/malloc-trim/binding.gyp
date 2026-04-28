{
  "targets": [{
    "target_name": "malloc-trim",
    "sources": ["malloc-trim.cc"],
    "conditions": [
      ["OS=='linux'", {
        "libraries": ["-lc"]
      }]
    ]
  }]
}
