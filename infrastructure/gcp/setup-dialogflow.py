"""Configure the free Dialogflow ES agent, annotated intents and entity synonyms."""
import json
import os
import re
import subprocess
import urllib.request
import urllib.error

PROJECT = 'fit3184-g80-ecoguard-dg26'
GCLOUD = os.environ.get('ECOGUARD_GCLOUD', '/opt/homebrew/share/google-cloud-sdk/bin/gcloud')
env = {**os.environ, 'CLOUDSDK_CORE_DISABLE_FILE_LOGGING': '1'}
token = subprocess.check_output([GCLOUD, '--configuration=ecoguard-fit3184', 'auth', 'print-access-token'], env=env, text=True).strip()
base = 'https://dialogflow.googleapis.com/v2/projects/' + PROJECT + '/agent'

def request(url, method='GET', body=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={'Authorization': 'Bearer ' + token, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit('Dialogflow setup failed: ' + error.read().decode()[:2000]) from None

agent = request(base, 'POST', {'parent': 'projects/' + PROJECT, 'displayName': 'Aussie EcoGuard G80', 'defaultLanguageCode': 'en', 'timeZone': 'Australia/Melbourne', 'enableLogging': False, 'classificationThreshold': 0.35, 'apiVersion': 'API_VERSION_V2', 'tier': 'TIER_STANDARD'})
if agent.get('tier') != 'TIER_STANDARD':
    raise SystemExit('Expected the no-charge Dialogflow Trial/Standard agent.')

species = {
    'cat': ['cats', 'kitten', 'kittens', 'feline'], 'dog': ['dogs', 'puppy', 'puppies', 'canine'],
    'bird': ['birds'], 'horse': ['horses'], 'sheep': [], 'cow': ['cows', 'cattle'],
    'elephant': ['elephants'], 'bear': ['bears'], 'zebra': ['zebras'], 'giraffe': ['giraffes'],
    'fox': ['foxes'], 'cane toad': ['cane toads'], 'kangaroo': ['kangaroos'], 'feral pig': ['feral pigs'],
}
appearance = {name: [] for name in ['ginger', 'black', 'white', 'brown', 'grey', 'gray', 'collar', 'tabby', 'striped', 'spotted', 'labrador', 'persian', 'golden retriever']}
entities = request(base + '/entityTypes').get('entityTypes', [])
for display, vocabulary in [('ecoguard_species', species), ('ecoguard_description', appearance)]:
    entity = {'displayName': display, 'kind': 'KIND_MAP', 'autoExpansionMode': 'AUTO_EXPANSION_MODE_UNSPECIFIED', 'entities': [{'value': name, 'synonyms': [name, *synonyms]} for name, synonyms in vocabulary.items()]}
    old = next((item for item in entities if item['displayName'] == display), None)
    if old:
        entity['name'] = old['name']; request('https://dialogflow.googleapis.com/v2/' + old['name'], 'PATCH', entity)
    else:
        request(base + '/entityTypes', 'POST', entity)

def phrase(text):
    parts, cursor = [], 0
    for match in re.finditer(r'\{(\w+):([^:}]+):([^}]+)\}', text):
        if match.start() > cursor: parts.append({'text': text[cursor:match.start()]})
        alias, entity, value = match.groups()
        parts.append({'text': value, 'alias': alias, 'entityType': '@' + entity, 'userDefined': True}); cursor = match.end()
    if cursor < len(text): parts.append({'text': text[cursor:]})
    return {'type': 'EXAMPLE', 'parts': parts}

parameters = [
    {'displayName': 'species', 'entityTypeDisplayName': '@ecoguard_species', 'value': '$species', 'isList': True, 'mandatory': True, 'prompts': ['Which animal species would you like to find?']},
    {'displayName': 'counts', 'entityTypeDisplayName': '@sys.number', 'value': '$counts', 'isList': True},
    {'displayName': 'descriptions', 'entityTypeDisplayName': '@ecoguard_description', 'value': '$descriptions', 'isList': True},
    {'displayName': 'date', 'entityTypeDisplayName': '@sys.date', 'value': '$date'},
    {'displayName': 'period', 'entityTypeDisplayName': '@sys.date-period', 'value': '$period'},
]
search = [
    'Show me {species:ecoguard_species:dogs}', 'Find photos of {species:ecoguard_species:cats}',
    'Show sightings with {counts:sys.number:2} {species:ecoguard_species:cats}',
    'Find at least {counts:sys.number:two} {species:ecoguard_species:dogs}',
    'Show {counts:sys.number:2} {species:ecoguard_species:cats} and {counts:sys.number:1} {species:ecoguard_species:dog}',
    'Find {species:ecoguard_species:dogs} and {species:ecoguard_species:cats}',
    'Show {species:ecoguard_species:foxes} spotted {date:sys.date:yesterday}',
    'Find {species:ecoguard_species:birds} from {period:sys.date-period:last week}',
    'Search for {species:ecoguard_species:cane toads}', 'Find {species:ecoguard_species:horses} {date:sys.date:today}',
    'Show {species:ecoguard_species:dogs} wearing a {descriptions:ecoguard_description:collar}',
    'Show videos of {species:ecoguard_species:dogs}',
]
lost = [
    'Help me find a lost {descriptions:ecoguard_description:ginger} {species:ecoguard_species:cat}',
    'I lost my {species:ecoguard_species:dog}', 'My {species:ecoguard_species:cat} is missing',
    'Find public sightings of my missing {species:ecoguard_species:dog}',
    'Find my {descriptions:ecoguard_description:black} {species:ecoguard_species:cat} with a {descriptions:ecoguard_description:collar}',
    'Lost {descriptions:ecoguard_description:labrador} {species:ecoguard_species:dog} seen {date:sys.date:yesterday}',
    'Look for my missing {descriptions:ecoguard_description:white} {species:ecoguard_species:cat} from {period:sys.date-period:last week}',
    'Help find my pet',
]
intents = request(base + '/intents').get('intents', [])
for display, examples in [('SearchSightings', search), ('LostPetSightings', lost)]:
    intent = {'displayName': display, 'action': display, 'trainingPhrases': [phrase(text) for text in examples], 'parameters': parameters}
    old = next((item for item in intents if item['displayName'] == display), None)
    if old:
        intent['name'] = old['name']; request('https://dialogflow.googleapis.com/v2/' + old['name'], 'PATCH', intent)
    else:
        request(base + '/intents', 'POST', intent)
if not any(item.get('isFallback') for item in intents):
    request(base + '/intents', 'POST', {'displayName': 'EcoGuardFallback', 'isFallback': True, 'messages': [{'text': {'text': ['Try “show me two dogs” or “help me find my lost ginger cat”.']}}]})
operation = request(base + ':train', 'POST', {})
subprocess.run([GCLOUD, '--configuration=ecoguard-fit3184', '--project=' + PROJECT, 'projects', 'add-iam-policy-binding', PROJECT,
                '--member=serviceAccount:ecoguard-aws-runtime@' + PROJECT + '.iam.gserviceaccount.com', '--role=roles/dialogflow.client', '--condition=None', '--quiet', '--format=none'], env=env, check=True)
print(json.dumps({'agent': agent['displayName'], 'tier': agent['tier'], 'trainingOperation': operation.get('name'), 'intents': ['SearchSightings', 'LostPetSightings']}))
