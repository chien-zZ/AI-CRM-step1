# File Center contracts

These V1 contracts expose stable file/content identifiers, processing state, transport-neutral resource links, and short-lived transfer grants. They never expose a storage bucket, object key/handle, provider credential, provider SDK type, permanent URL, malware-engine payload, or binary content.

`FileReference` is the only value business modules persist. Transfer grants are ephemeral results issued after current authorization and are not business facts. Declared upload metadata is not trusted; usable metadata comes from storage inspection and scanning.
