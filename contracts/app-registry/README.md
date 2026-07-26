# Application Registry contracts

`application-registry.v1.schema.json` describes stable application, navigation, and route identifiers. `deep-link.v1.schema.json` carries only registered identifiers and a bounded opaque resource reference. It never carries an arbitrary URL and never proves authorization; the resolver checks current enablement, audience, source allowlist, and target permission on every use.
