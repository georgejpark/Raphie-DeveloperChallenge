# Raphie Developer Challenge: cold outreach email CLI

A Node.js command-line tool that writes cold outreach emails from Raphie to companies in the iGaming and sports betting ecosystem. It asks for the recipient, company, a short description and a tone, enriches that with the go-to-market helper endpoint, drafts the email with the OpenAI API, and then **proves** the result follows Raphie's "must not feel AI-generated" rules before printing it.

Submitted by George Park for @agould65.

```
$ npm start

Recipient's name (e.g. "Alex Gould"): Jane Doe
Company name (e.g. "Big Bet Sports"): Riverline Sportsbook
Short description of the company (e.g. "..."): A sportsbook operator with high withdrawal volume, KYC questions, promo eligibility disputes, and periodic support spikes on big game days
Tone (direct / warm) (e.g. "direct"): direct
Looking up go-to-market hints...
Drafting the email...

Hi Jane,
...
Best,
Raphie

Checks passed (1 draft).
```

## Contents

1. [Quick start](#1-quick-start)
2. [Usage](#2-usage)
3. [How it works, step by step](#3-how-it-works-step-by-step)
4. [The go-to-market helper and the confidence policy](#4-the-go-to-market-helper-and-the-confidence-policy)
5. [Prompt design and dynamic conditioning](#5-prompt-design-and-dynamic-conditioning)
6. [Output constraints and how they are enforced](#6-output-constraints-and-how-they-are-enforced)
7. [Tests and the offline demo](#7-tests-and-the-offline-demo)
8. [Project structure](#8-project-structure)
9. [Design decisions and assumptions](#9-design-decisions-and-assumptions)
10. [What I would do with more time](#10-what-i-would-do-with-more-time)

## 1. Quick start

Requirements: Node.js 20 or newer (tested on 22), npm, an OpenAI API key.

```bash
git clone https://github.com/georgejpark/Raphie-DeveloperChallenge.git
cd Raphie-DeveloperChallenge
npm install                      # one dependency: openai

cp .env.example .env             # then put the OpenAI key in .env
#   OPENAI_API_KEY=sk-...

npm start                        # interactive prompts
npm test                         # 30 unit tests, no network needed
npm run demo:offline             # full pipeline against a local mock, no key needed
```

The key is read from the `OPENAI_API_KEY` environment variable or from a local `.env` file (git-ignored). It is never stored in the repository.

## 2. Usage

```
raphie [options]

  --name <recipient>        Recipient's name, e.g. "Alex Gould"
  --company <company>       Company name, e.g. "Big Bet Sports"
  --description <text>      Short description of the company
  --tone <direct|warm>      Tone of the email
  --skip-helper             Do not call the go-to-market helper
  --max-attempts <n>        Model calls allowed before mechanical repair (default 3)
  --debug                   Show helper response, confidence tier, chosen angles, validation per draft
  --json                    Machine-readable output (input, helper data, tier, angles, email)
  -h, --help
```

Anything not supplied as a flag is asked interactively with `readline`; answers are validated and re-asked (tone must be `direct` or `warm`, description needs at least three words). Flags make the tool scriptable:

```bash
node src/index.js --name "Jane Doe" --company "ApexPay Gaming" \
  --description "A payments provider for iGaming operators that supports card, ACH, and crypto on-ramps, and handles a high volume of payout status and fraud review tickets" \
  --tone warm --debug
```

Exit codes: `0` email printed and all checks pass, `1` configuration or API failure, `2` bad input, `3` email printed but a rule is still broken after all attempts (the warning lists which).

Environment variables (all optional except the key): `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`), `OPENAI_BASE_URL`, `GTM_ENDPOINT`, `GTM_TIMEOUT_MS` (8000), `GTM_RETRIES` (3).

## 3. How it works, step by step

```
 ┌──────────────┐   ┌────────────────────┐   ┌──────────────────┐   ┌────────────────┐
 │ 1. Collect   │──▶│ 2. GTM helper      │──▶│ 3. Interpret     │──▶│ 4. Build prompt│
 │ input (CLI)  │   │ POST {name}        │   │ confidence tier  │   │ facts vs hints │
 │ readline /   │   │ timeout + retries  │   │ + description    │   │ tone guide     │
 │ flags        │   │ 503 -> backoff     │   │ -> 1-3 "angles"  │   │ house rules    │
 └──────────────┘   └────────────────────┘   └──────────────────┘   └───────┬────────┘
                                                                            │
 ┌──────────────┐   ┌────────────────────┐   ┌──────────────────┐           ▼
 │ 8. Print     │◀──│ 7. Sanitize        │◀──│ 6. Validate      │◀──┌────────────────┐
 │ email +      │   │ (mechanical fixes, │   │ 7 rules + name/  │   │ 5. OpenAI      │
 │ report       │   │ last resort only)  │   │ company present  │   │ chat completion│
 └──────────────┘   └────────────────────┘   └────────┬─────────┘   └────────────────┘
                                                      │ violations?  feed them back,
                                                      └──────────────▶ redraft (max 3)
```

| Step | What happens | Where |
|---|---|---|
| 1 | Collect the four inputs. Flags are accepted; missing ones are prompted with `readline` and validated. The API key is checked **before** asking questions so nobody types four answers and then sees a config error. | `src/cli/prompts.js`, `src/index.js` |
| 2 | `POST {name}` to the helper with an 8 s timeout per attempt and up to 3 retries (exponential backoff with jitter) on 503/5xx/429/timeouts/network errors. 4xx is not retried. A malformed 200 is treated as unavailable. The helper is never fatal. | `src/gtm/client.js` |
| 3 | Classify the helper's `confidence` into HIGH / MEDIUM / LOW, read the description with a small keyword classifier (company type, crypto, KYC, volume, regions, pain points), merge the two with "description wins", and pick at most three **angles** for the email. Each angle is marked as a fact the writer may *assert* or a hint it may only *suggest*. | `src/gtm/interpret.js` |
| 4 | Turn that into a writer's brief: recipient, what we know and how sure we are, what the email must do in order, tone guide, house style rules. | `src/email/prompt.js` |
| 5 | One `chat.completions` call (`gpt-4o-mini` by default, temperature 0.7 for the first draft, 0.3 for rewrites). | `src/email/generate.js` |
| 6 | Validate every draft against the seven rules plus "name and company present". | `src/email/validate.js` |
| 7 | If a draft fails, the exact violations and the previous draft go back to the model for a rewrite (up to `--max-attempts`, default 3). After the last attempt the deterministic sanitizer fixes what can be fixed safely (em dashes, banned words/starters, extra exclamation marks) and the result is validated one final time. | `src/email/generate.js`, `src/email/sanitize.js` |
| 8 | Print the email, then a one-line report (`Checks passed (2 drafts)`) or a warning listing any rule still broken. `--json` prints everything for scripting. | `src/index.js` |

## 4. The go-to-market helper and the confidence policy

The endpoint returns `vertical`, `companyType`, `operatingRegions`, `supportMotion`, `isCryptoRelated`, `kycAmlIntensity` and `confidence` (0.0 to 1.0).

### Reliability

| Brief says | What the client does |
|---|---|
| "can occasionally take several seconds" | `AbortController` timeout per attempt (`GTM_TIMEOUT_MS`, 8 s) |
| "may return 503 a small percentage of the time" | retries 503, 502, 504, 500, 429, 408 and network errors, backoff 300 ms, 600 ms, 1.2 s (+ jitter), `GTM_RETRIES` = 3 |
| anything else goes wrong | returns `{status: 'unavailable', reason}`; the CLI says so and writes the email from the description alone |

### Confidence tiers (the reasoning the brief asks for)

A cold email that asserts a wrong fact about the recipient's own business is worse than one that says nothing: the reader knows their company and the error ends the conversation. So the question is not *whether* to use the helper data but *how hard the email may lean on it*.

| Tier | Range | How the fields are used |
|---|---|---|
| **HIGH** | `confidence >= 0.70` | Treated as facts the writer knows. Company type, region, KYC load, crypto and support motion may be stated plainly ("Given Riverline's volume and the complexity that comes with US requirements..."). |
| **MEDIUM** | `0.40 <= confidence < 0.70` | Used as hints only, in hedged, outside-in language ("From the outside, ApexPay Gaming looks like..."). Regions are dropped at this tier because a wrong region is the most embarrassing mistake to make. Nothing from the helper may contradict the description. |
| **LOW** | `confidence < 0.40` | The payload is discarded for conditioning. The email is written from the description alone, exactly as if the helper were down, and the prompt tells the model not to assert regions, licences or volumes. `--debug` still shows what the helper said. |

Why 0.40 and 0.70: below about 0.4 the helper is closer to guessing than knowing; above about 0.7 it is confident enough that stating a fact is a reasonable risk in a cold email. Both are named constants (`CONFIDENCE_LOW`, `CONFIDENCE_HIGH` in `src/gtm/interpret.js`) so they can be tuned once real precision data exists.

### Which fields add value and which are noise

| Field | Used for | Noise when |
|---|---|---|
| `companyType` | Picks the **playbook**: who the audience is, what the ticket mix looks like, which value proposition fits (operator: containment of player questions; payments: two-sided demand and fraud reviews; B2B supplier: tier-1 triage and SLAs; affiliate: agent assist over deflection; risk/compliance: auditability; data: technical triage). This is the single most valuable field. | The description already says what the company is (then the description wins). |
| `operatingRegions` | One region note (US state-by-state requirements, UKGC affordability checks, LATAM payment rails...). | Confidence is below HIGH, or more than one region (we use at most one). |
| `kycAmlIntensity` | `high` adds the verification/KYC angle. | Company is an affiliate; `low`/`unknown` is ignored. |
| `isCryptoRelated` | Adds wallet / confirmation-time / AML questions. | `false` (nothing to say). |
| `supportMotion` | `high_volume` steers toward containment and spikes; `low_volume` toward agent assist and resolution time. | `mixed`/`unknown`. |
| `vertical` | Vocabulary only (players vs customers). Rarely changes the email. | Almost always; the playbook carries it. |
| `confidence` | Gate for all of the above. | Never. |

The description is always parsed first, and it always wins when it conflicts with the helper. At most three angles are used so the email stays focused: company type, then crypto, then one region, then KYC, then volume.

## 5. Prompt design and dynamic conditioning

The prompt is a **writer's brief**, not a form to fill (`src/email/prompt.js`):

1. **System message.** Who Raphie is, who the recipient is, how an experienced sales engineer writes. "Output only the email body."
2. **Recipient.** Name (and the first name to use), company, the team's description verbatim.
3. **What we know.** The playbook sentence ("We know X is a B2C operator. Their audience is players." or, at MEDIUM, "It appears X is..."), the pain points named in the description, then two lists: *facts you may state plainly* and *likely but unconfirmed, hedge these*. With no usable helper data the brief says so explicitly and forbids guessing regions or volumes.
4. **What the email must do, in order.** Greet by first name; say you are from Raphie; show you understand their world (the commentary on why their space is a strong candidate for automation); state the value proposition chosen by the playbook; the call to action; the sign-off.
5. **Tone guide.** `direct`: get to the point, short sentences, "Best,"; `warm`: one human opener, collaborative, "Warm regards,". Each has its own target length.
6. **House style.** The seven rules in plain language, plus "no bullets, no subject line, do not invent numbers". Repeated at the end because recency helps compliance.
7. **On a rewrite:** the exact violations and the previous draft, with the instruction to rewrite the whole email.

Temperature is 0.7 for the first draft and 0.3 for rewrites. Run with `--debug` to see which tier and angles were chosen for a given input.

## 6. Output constraints and how they are enforced

The model is asked to follow the rules; the validator makes sure it did (`src/email/validate.js`). Every draft is checked:

| Rule | Check |
|---|---|
| No em dashes | `—` (U+2014) anywhere |
| No "Furthermore" / "Additionally" starting a sentence | first word of each sentence, case-insensitive |
| No "fantastic" | whole word, case-insensitive |
| At most one exclamation mark | count of `!` |
| No two consecutive sentences start with the same word | first words compared in reading order; the greeting and sign-off lines count as units |
| No sentence over 30 words | words with at least one letter or digit |
| Recipient's first name and company name present | the short form of the company ("Riverline" for "Riverline Sportsbook") is accepted, as in the brief's example |

Sentence splitting: a line break always ends a sentence (so "Hi Jane," and "Best," are their own units), `. ! ?` followed by whitespace ends one inside a paragraph, and common abbreviations (e.g., i.e., U.S.) are protected.

Enforcement order: **regenerate first, repair last**. Violations are fed back to the model because mechanical rewriting of long sentences produces worse prose than asking again. Only after the attempt budget does the sanitizer (`src/email/sanitize.js`) apply safe replacements (em dash to comma, drop the banned starter, "fantastic" to "great", extra `!` to `.`), and the final validation result is always reported honestly (exit code 3 if anything remains).

A small finding while writing the tests: both example emails in the brief contain sentences longer than 30 words (32 words in example 1; 33 and 32 in example 2). The validator flags them, and the tests assert that no *other* rule fires on the examples. The generator holds the stricter line.

## 7. Tests and the offline demo

```bash
npm test               # node:test, 30 tests, ~1 s, no network
npm run demo:offline   # starts scripts/mock-server.js, runs the CLI 3 times, stops it
```

| File | Covers |
|---|---|
| `test/validate.test.js` | every rule, sentence splitting edge cases, name/company presence, the sanitizer, the brief's two examples |
| `test/interpret.test.js` | tier boundaries, description classifier, HIGH/MEDIUM/LOW/unavailable behaviour, description-beats-helper, angle cap |
| `test/client.test.js` | real HTTP against a throwaway local server: request shape, 503 retry then success, retry budget exhausted, 4xx not retried, timeout then retry, malformed 200, connection refused |
| `test/generate.test.js` | the draft/validate/redraft loop with a fake OpenAI client: clean first draft, violations fed back with lower temperature, sanitizer after the budget, output cleaning |

`scripts/mock-server.js` stands in for both external services so the whole CLI can run with no key: `Big Bet Sports` returns confidence 0.85 (HIGH), `ApexPay Gaming` 0.62 (MEDIUM), anything else 0.15 (LOW); a company name containing `flaky` gets a 503 on the first call; `MOCK_DIRTY_FIRST=1` makes the fake model break three rules on its first draft so the redraft loop is visible. GitHub Actions (`.github/workflows/ci.yml`) runs the tests and the offline demo on every push.

## 8. Project structure

```
src/
  index.js            entry point: flags, orchestration, output, exit codes
  cli/prompts.js      readline prompts, validation, flag/prompt merge
  gtm/client.js       helper endpoint client: timeout, retries, normalisation
  gtm/interpret.js    confidence policy, description classifier, playbooks, angles
  email/prompt.js     system + user prompt (the writer's brief), tone guides, style rules
  email/generate.js   OpenAI call, draft -> validate -> redraft loop, sanitizer fallback
  email/validate.js   the constraint checker
  email/sanitize.js   deterministic last-resort repairs
  util/env.js         tiny .env loader (no dependency)
scripts/
  mock-server.js      offline stand-in for the helper and the OpenAI endpoint
  demo-offline.js     one-command demonstration of all three confidence tiers
test/                 node:test suites (see above)
.github/workflows/ci.yml
.env.example
```

One runtime dependency (`openai`). Everything else is Node core.

## 9. Design decisions and assumptions

- **The helper is an enhancement, not a dependency.** The tool must still produce a good email when the endpoint is slow, flaky or wrong, so the fallback path (description only) is a first-class path, not an error.
- **Description beats helper.** The person typing the description has first-hand context; the helper fills gaps.
- **Fewer, sharper angles.** At most three signals go into the prompt. A cold email that mentions everything says nothing.
- **Validate, do not trust.** Prompt instructions are the first layer; the validator is the one that counts. Regeneration with feedback is preferred over string surgery.
- **Chat Completions API** rather than the newer Responses API, for the widest compatibility with SDK versions and OpenAI-compatible endpoints (which is also what makes the offline mock trivial).
- **`gpt-4o-mini` by default**: fast and cheap for 150-word emails; `OPENAI_MODEL` overrides it.
- **No framework.** `node:util.parseArgs`, `node:readline`, `node:test`, global `fetch`. Nothing to learn, nothing to patch.
- The temporary API key from the challenge email is used only through the environment and is not committed anywhere.

## 10. What I would do with more time

- **Evaluation harness.** Run 50 to 100 synthetic companies through the pipeline, store the drafts, and score them for rule compliance, "AI smell" (a second model as judge), and specificity; track first-draft pass rate per model and prompt version.
- **Structured output.** Ask the model for `{greeting, paragraphs[], cta, signoff}` as JSON and assemble the email, which makes the structural checks almost free and lets the sanitizer operate per sentence.
- **Few-shot by company type.** Keep one vetted example per playbook (operator, payments, affiliate...) and include the matching one in the prompt.
- **Subject lines and A/B variants.** Generate two or three subject lines and an alternative opener, all run through the same validator.
- **Richer region and compliance knowledge.** A small data file per market (regulator, typical payment rails, languages) instead of one sentence each.
- **Caching and rate limits.** Cache helper responses by company name for a day; respect `Retry-After` on 429/503.
- **Observability.** Log tier, angles, attempts and violations per run so the thresholds (0.40/0.70) can be tuned from data.
- **Packaging.** Publish as an npm bin, add a `--out file.txt` option and CSV batch mode for a prospect list.
