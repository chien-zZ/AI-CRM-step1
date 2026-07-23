# Application Registry

Owns registered applications, navigation entries, routes, enablement, and required permission codes for the workbench shell.

Notification and task deep links use registered application and route identifiers plus non-sensitive resource references. They never store arbitrary URLs or imply authorization; the target route and API recheck current permissions.
