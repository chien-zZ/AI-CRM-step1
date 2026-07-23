# Compose Environments

Expected definitions cover local development, isolated CI/testing, staging, and production. Production has a separate Compose project and explicit service-placement overlay for each of the two hosts; no file may imply that Docker Compose schedules across hosts.

Do not add placeholder services until component versions, ports, persistence, health checks, resource limits, shutdown behavior, backup responsibility, and host placement are reviewed. Production definitions must not contain default passwords, literal secrets, floating image versions, public state-service ports, or destructive Volume lifecycle commands.

Production services declare named Compose `secrets` or reviewed read-only single-file mounts. Compose contains only the host reference path and container target; each service receives only its own Secret files. A production `.env` may not store Secret values, and unsupported third-party images require a reviewed file-to-process adapter rather than copying values into the image or command line.

See [ADR-0021](../../docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md) and [ADR-0023](../../docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md).
