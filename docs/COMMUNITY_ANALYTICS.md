# Community analytics

The v1.3 analytics foundation supports a privacy-safe server dashboard, an
activity heatmap, and a year-in-review aggregate. Reports contain only UTC day,
event counts, failure counts, and bounded windows. They do not retain message
content, member identity, prompts, or raw Discord payloads. Empty and degraded
states must be shown explicitly by the Command Deck. Future UI work can render
these projections without changing the storage contract.
