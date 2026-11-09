# Live frontend

URL: https://fit3184-g80-ecoguard-dg26.web.app

The static React frontend is served over HTTPS by Firebase Hosting in the existing EcoGuard GCP project. The project has no billing account linked. Firebase terms were accepted with the student's explicit approval; optional Analytics was disabled. AWS Academy denies CloudFront access, so the frontend uses its explicitly configured API Gateway HTTPS origin instead of a CloudFront reverse proxy.

On 9 November 2026, the student signed into the deployed site with the existing Cognito account. The authenticated field journal loaded the user's collection successfully. No password or bearer token was extracted for testing. Image/video processing has separate live backend evidence in CLOUD_MODEL_VERIFICATION.md; browser upload/playback/search verification continues separately.

The API and S3 CORS allow the precise hosted frontend origin. Bearer tokens go only to the configured API Gateway origin; direct signed S3 transfers omit Cognito credentials. The static site has a Content Security Policy, framing restriction, no-referrer policy and MIME-sniffing protection. Media objects remain private. Deployments publish only the compiled frontend assets, never environment files, source maps or AWS credentials.

Run `python3 infrastructure/gcp/deploy-hosting.py` from the repository with Node/npm available and the named EcoGuard gcloud account authenticated. The deployer checks project/site identity and billing-disabled status before publishing content-addressed assets through the official Firebase Hosting REST API. AWS deployment must set `ECOGUARD_FRONTEND_ORIGIN=https://fit3184-g80-ecoguard-dg26.web.app`.
