CREATE SCHEMA app_registry;
CREATE TABLE app_registry.applications (
  application_id varchar(128) PRIMARY KEY,
  audience varchar(16) NOT NULL CHECK (audience IN ('internal','external')),
  enabled boolean NOT NULL,
  permission_code varchar(129) NOT NULL
);
CREATE TABLE app_registry.routes (
  route_id varchar(128) PRIMARY KEY,
  application_id varchar(128) NOT NULL REFERENCES app_registry.applications(application_id),
  path varchar(256) NOT NULL,
  enabled boolean NOT NULL,
  permission_code varchar(129) NOT NULL,
  deep_link_sources text[] NOT NULL,
  CONSTRAINT routes_application_route_unique UNIQUE (application_id, route_id),
  CONSTRAINT routes_path_safe CHECK (path ~ '^/[a-z0-9_./:-]{0,255}$' AND path !~ '//|\.\.|[?#]'),
  CONSTRAINT routes_sources_safe CHECK (deep_link_sources <@ ARRAY['task','notification']::text[])
);
CREATE INDEX routes_application_idx ON app_registry.routes (application_id);
CREATE TABLE app_registry.navigation (
  navigation_id varchar(128) PRIMARY KEY,
  application_id varchar(128) NOT NULL REFERENCES app_registry.applications(application_id),
  route_id varchar(128) NOT NULL,
  parent_navigation_id varchar(128) REFERENCES app_registry.navigation(navigation_id),
  enabled boolean NOT NULL,
  display_order integer NOT NULL CHECK (display_order BETWEEN 0 AND 100000),
  CONSTRAINT navigation_not_self_parent_check CHECK (parent_navigation_id IS NULL OR parent_navigation_id <> navigation_id),
  CONSTRAINT navigation_application_id_unique UNIQUE (application_id, navigation_id),
  CONSTRAINT navigation_route_fk FOREIGN KEY (application_id, route_id) REFERENCES app_registry.routes(application_id, route_id),
  CONSTRAINT navigation_parent_fk FOREIGN KEY (application_id, parent_navigation_id) REFERENCES app_registry.navigation(application_id, navigation_id)
);
CREATE INDEX navigation_application_order_idx ON app_registry.navigation (application_id, display_order);
CREATE TABLE app_registry.operation_receipts (
  operation_id uuid PRIMARY KEY,
  fingerprint varchar(64) NOT NULL CHECK (length(fingerprint) = 64),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
