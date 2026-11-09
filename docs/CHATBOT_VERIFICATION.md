# Dialogflow conversational search

The teaching-team-approved Dialogflow alternative is used instead of Lex (see ASSESSMENT_CLARIFICATIONS.md). The agent runs in the existing EcoGuard GCP project on the no-charge Trial/Standard tier; no billing account is linked and interaction logging is disabled.

The agent has annotated SearchSightings and LostPetSightings intents, species synonyms, descriptive-tag entities, number slots and date/date-period slots. The authenticated AWS API Lambda calls real Dialogflow detectIntent with a session ID derived from both the Cognito subject and a random conversation ID, then fulfills recognised queries through the existing Firestore search functions. It is not a keyword-only chatbot. Required species prompts and ambiguous-count messages avoid silently inventing missing filters.

Counts use AND/minimum semantics. Lost-pet requests use only public sightings, with a default 30-day window; ordinary searches retain owner/public access rules. Dates are interpreted in Australia/Melbourne, including daylight-saving boundaries. Breeds and colours match manual tags rather than claiming the detector identifies them.

Live checks on 9 November 2026: Dialogflow recognised “Show me dogs”, “Show two cats and one dog”, “Help me find my lost ginger cat”, a yesterday query and a last-week query with the expected intents/entities. In the deployed Chrome UI, “Show me dogs” returned both matching demo files; “Help me find my lost dog” returned only the public photo and excluded the private video. Clicking the returned photo opened its protected original viewer.

Recreate the agent/entities/intents using infrastructure/gcp/setup-dialogflow.py. The dedicated federated runtime identity receives roles/dialogflow.client in addition to its existing Firestore role; no service-account key is created. Unit tests verify fulfilment arguments, owner-isolated sessions, required slots, ambiguous counts and Melbourne daylight-saving date boundaries.
