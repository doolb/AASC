# Environment metadata

An environment describes one isolated device, browser, or replay source. Its
runtime adapter must provide frameSource.next(). A commandExecutor may be
provided when the bound role is allowed to execute commands.

Do not commit credentials or live device handles. The host application resolves
this metadata and injects the actual frame source, model adapters, clock, and
executor.
