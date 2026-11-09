# Confirmed email alerts

Implemented and deployed on 9 November 2026. The authenticated API obtains the recipient address from Cognito GetUser using the verified access token and requires a matching subject and verified email. Clients cannot supply a different recipient. The student explicitly authorised the test confirmation and alert emails and confirmed the SNS subscription from their inbox.

Each user has a dedicated SNS topic and email subscription with a watched-tag filter policy. The worker also checks matching tags and current visibility: other users receive only public sightings; private sightings can notify their owner. Messages contain an authenticated application link rather than an expiring signed S3 URL. Opt-out disables the database preference before removing its dedicated topic.

Upload and actual tag changes commit an outbox event with the metadata revision. A one-minute EventBridge schedule invokes a separate publisher Lambda. Per-recipient transactional claims fence concurrent workers; successful publications are recorded so normal retries do not resend them. SNS standard delivery is at least once, so duplicates are still possible if a response/commit fails. Superseded revisions, deleted media and unconfirmed subscriptions do not trigger publications. Tag edits that make no change create no misleading update event.

Live evidence: the deployed browser confirmed a dog subscription; bulk tag addition across an image and video produced two update publications; a new matching PNG produced one upload publication. A separate flat-colour control completed inference with no supported animals and produced zero publications. All were processed by the real federated Lambda/outbox/SNS flow. Inbox receipt is recorded separately after student confirmation; SNS accepting a publication is not by itself proof of inbox delivery.

The Firestore-emulator notification test verifies tag filtering, owner privacy, verified-recipient binding, concurrent publisher claims, idempotent replay, no-op tag updates, unsubscribe and deletion of matching delivery records. Media deletion removes outbox and delivery entries; late publisher checks avoid recreating deleted media metadata.

AWS subscription filter changes can take up to 15 minutes to propagate: https://docs.aws.amazon.com/sns/latest/dg/sns-subscription-filter-policies.html . The UI explains this and exposes confirmation-status refresh. A real email recipient must click the SNS confirmation link before receiving alerts; no confirmation token or account password is captured by the application.
