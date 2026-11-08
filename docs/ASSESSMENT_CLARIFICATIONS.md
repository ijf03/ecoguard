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
- Cognito's user-pool list loaded in `us-east-1` with zero pools and no listing error. Creation, app-client configuration, email verification and temporary-password flows remain unverified.
- The current Learner Lab identity was explicitly denied `lex:ListBots`, `lex:ListImports` and `lex:ListExports`. This is a limitation of this lab identity, not proof that Lex is unavailable in all Academy courses/accounts.
- GCP CLI authentication was refreshed by the student. An open education billing account is visible. Remaining promotional credit has not yet been independently confirmed.
- Created separate GCP project `fit3184-g80-ecoguard-dg26`, display name `Aussie EcoGuard FIT3184 G80`, project number `342766879838`. Verified ACTIVE and billing disabled. Only the default Cloud APIs setup associated with project creation ran. No Dialogflow agent, database, compute workload or paid deployment has been created.
- SmartPark is a separate assignment. Its project/resources were not used or changed for EcoGuard. Commands for EcoGuard must specify the new project explicitly; the user's existing CLI default was preserved.

## Remaining deployment gates

Confirm remaining education credit and allowed service/edition; verify Cognito creation permissions; configure least-privilege execution and cross-cloud authentication; create the real chatbot and deploy the required backend/storage/database/notification components. The existing CLOUD_TRANSITION document describes an earlier proposal and is not a deployed architecture. Reconcile the final diagram and reports with the services actually implemented.
