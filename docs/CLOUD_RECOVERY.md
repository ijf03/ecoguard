# Cloud recovery and deletion

Cloud metadata uses recoverable states for abandoned uploads, expired processing leases and interrupted deletion. A bounded reconciler examines at most 25 media records and 25 deletion records per run, with cursors so large collections progress across invocations. A permission or network error never proves an object is missing.

Deleting an item removes all source/thumbnail versions, its full media metadata, checksum reservation and pending notification events. A minimal temporary deletion record retains only the ID, storage key and cleanup deadline to catch late writes from already-issued upload capabilities or in-flight workers. After the quiet period, reconciliation repeats storage cleanup and removes this record too. These are compensating operations across S3 and Firestore, rather than a distributed transaction.

Validation on 9 November 2026: 11 cloud integration tests passed against the local Firestore emulator, including retry after partial cleanup, expired uploads, denied storage access, stale workers and final deletion cleanup. These tests use real Firestore emulator transactions and mocked storage operations; deployed recovery verification is tracked separately.
