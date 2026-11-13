# Role metadata

Role metadata identifies a package and its recognition/computation profile. The
host application injects executable recognition and execution adapters when it
creates a RoleRuntime.

Do not put ADB handles, browser sessions, credentials, or model objects in
these files. Keep those resources in the host environment and expose only the
required adapter interfaces.
