Privacy Disclosures for Optional Semantic Matching

Overview
- The core AIAutoFill matching engine runs fully locally in your browser using heuristic and deterministic signals (no data leaves the page).
- An optional semantic matching layer can be enabled to improve ranking using text embeddings from an external service (MiniLM/TinyBERT or compatible).

What data is sent when semantic matching is enabled?
- Only minimal context is sent: label-like strings needed to identify fields
  - Ontology key labels (e.g., "Email", "Phone", "Full Name")
  - Detected field labels (accessible name) from the page (e.g., the visible text label for a form field)
- No field values, user input, or broader page content is sent.
- Attribute names and raw HTML are not sent.

Batching and caching
- Requests are batched to minimize the number of network calls.
- Embeddings are cached in-memory for the duration of the session with a configurable TTL. Cached vectors avoid re-sending the same labels.

Graceful degradation and offline behavior
- If the embeddings service is unavailable or times out, the extension gracefully falls back to purely local heuristics and remains functional.

Configuration transparency
- Semantic matching is disabled by default. To enable it, you must explicitly configure an embeddings endpoint via environment variables (see README).
- When enabled, a one-time console notice is shown in the page indicating that minimal label text may be sent to the configured service.

Operator responsibility
- You are responsible for selecting and operating the embeddings service endpoint, including its privacy practices, data handling, and retention policies. Review the service's privacy policy before enabling.

Security notes
- If your service requires authentication, you can configure an API key that will be sent as an Authorization: Bearer header.
- Consider network egress policies and CORS settings suitable for browser extensions.

Contact
- If you have questions or privacy concerns about this optional feature, please file an issue in the repository.
