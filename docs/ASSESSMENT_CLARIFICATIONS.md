# Assessment clarifications and current cloud readiness

Checked 8 November 2026 against the course Ed Discussion while signed in, in addition to the supplied specification/rubric. This record is evidence for interpreting assessment requirements, not a claim that the referenced workflows have been implemented.

## Chatbot provider

The supplied rubric labels the chatbot AWS Lex. Staff explicitly permit an equivalent service from another vendor.

- [Ed #206: Need to use Lex?](https://edstem.org/au/courses/38454/discussion/3630831): Jay Zhao's accepted answer on 10 October 2026 allows equivalent services and gives GCP Dialogflow as an example.
- [Ed #289: Chatbot](https://edstem.org/au/courses/38454/discussion/3695668): the 2 November 2026 follow-up explains that Lex is available in AWS Academy ML Foundations. Jay's later comment leaves the provider choice to students and confirms that staff Ed answers can officially supplement or slightly alter the specification.

Decision: use a real GCP Dialogflow chatbot as the permitted alternative. Keep the full assessed behaviour: intent/entity recognition, real authorised backend search/fulfillment, natural-language species/count and lost-pet queries, and clickable media results in the frontend. A fake or keyword-only local chatbot is not completion. AWS Cognito remains required; this clarification concerns the chatbot provider only.

Preserve these references in the team report/demo notes so the architecture's difference from the rubric's Lex label is reviewable.

## Account checks

- AWS Academy Learner Lab session is running, with a displayed budget of $50 and $0 used at the time checked. Budget displays may lag usage.
- The current Learner Lab documentation restricts services to `us-east-1` / `us-west-2`, limits IAM role creation, and provides `LabRole` for service execution. These limits must shape the deployed design.
- Created Cognito pool `us-east-1_HUV4NQ98r` and public SPA client `43n2ru3iuds0ph59ldme1adv5l` in `us-east-1` after student approval. Email sign-in, required email/first/last names and self-registration are enabled. The student completed real registration, email confirmation and sign-in; the protected collection displayed their name. Temporary-password changes, password recovery and live sign-out have not yet been exercised.
- The current Learner Lab identity was explicitly denied `lex:ListBots`, `lex:ListImports` and `lex:ListExports`. This is a limitation of this lab identity, not proof that Lex is unavailable in all Academy courses/accounts.
- GCP CLI authentication was refreshed by the student. An open education billing account is visible. The billing Credits table showed $48.93 available from the FIT3184 credit, expiring 7 August 2027 (displayed amounts may lag usage).
- Created separate GCP project `fit3184-g80-ecoguard-dg26`, display name `Aussie EcoGuard FIT3184 G80`, project number `342766879838`. Verified ACTIVE and billing disabled. Enabled Firestore and federation APIs. Created `(default)` Firestore Native / Standard in `us-east1`, with freeTier true and deletion protection enabled. Billing remains disabled. A live synthetic metadata smoke test passed using the existing gcloud user and cleaned up its fixture collections. No Dialogflow agent, GCP compute workload or paid deployment has been created.
- Created federation pool `ecoguard-aws`, provider `learner-lab`, restricted to the verified AWS account and the `LabRole` assumed-role ARN prefix. Service account `ecoguard-aws-runtime` has `roles/datastore.user`; its workloadIdentityUser binding accepts only that pool/role. No user-managed service-account key exists. AWS-runtime exchange remains unverified until the Lambda probe succeeds.
- SmartPark is a separate assignment. Its project/resources were not used or changed for EcoGuard. Commands for EcoGuard must specify the new project explicitly; the user's existing CLI default was preserved.

## Remaining deployment gates

Verify the selected GCP service/edition and billing before provisioning; configure least-privilege execution and cross-cloud authentication; create the real chatbot and deploy the required backend/storage/database/notification components. The existing CLOUD_TRANSITION document describes an earlier proposal and is not a deployed architecture. Reconcile the final diagram and reports with the services actually implemented.
