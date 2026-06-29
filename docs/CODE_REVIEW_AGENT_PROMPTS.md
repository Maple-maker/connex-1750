# Code Review Agent Prompts

Jaiden's code review framework for Army projects, financial automation, and product builds.

---

## 🔴 TIER 1: Safety & Clarity (Always Run First)

### Prompt: Logic & Correctness Check
**Use for:** Scripts handling financial data, deployment automation, sensitive operations

```text
Review this {LANGUAGE} code for logical correctness and safety.

Specifically:
1. Are there off-by-one errors, infinite loops, or edge case bugs?
2. Does the code handle empty inputs, null values, and API failures gracefully?
3. Are variable names clear enough that a junior dev could follow the logic?
4. Any hardcoded values (IPs, API keys, account IDs, thresholds) that should be env vars or configs?
5. If this touches financial data (balance, trades, payments), does it validate inputs and log actions?

For each issue, explain the bug simply and suggest a 1-line fix if possible.
Also flag any lines you'd want to see tested before production.
```

### Prompt: Readability Audit
**Use for:** Any code you'll hand off or maintain in 6 months

```text
I'm a Python beginner building production tools. Review this code for readability:

1. **Function length**: Are any functions doing too many things? (Rule of thumb: if I scroll to read it, it's too long.)
2. **Variable naming**: Would someone unfamiliar with this project understand what each variable does?
3. **Comments**: Is there a comment above each function explaining what it does and why? Are there inline comments explaining non-obvious logic?
4. **Magic numbers**: Any numbers (thresholds, IDs, timeouts) that should have a named constant instead?
5. **Function signatures**: Are parameters clear? Would a type hint help?

Flag 3-5 biggest clarity wins and show the refactored version.
```

---

## 🟡 TIER 2: Maintainability & Patterns

### Prompt: Maintainability Review (Karpathy's Principles)
**Use for:** Scripts you'll iterate on (AEGIS automation, trading bots, content pipelines)

```text
I follow Andrej Karpathy's coding principles:
1. Simplicity (minimal abstractions)
2. Readability (obvious intent, single scan)
3. Debuggability (easy to inspect state, clear logs)
4. Testability (pure functions, no side effects)

Review this code against these principles:

- **Simplicity**: Are there unnecessary classes, decorators, or abstractions? Would the code be clearer without them?
- **Readability**: Can I trace execution without jumping between 10 functions? Are error paths obvious?
- **Debuggability**: Can I print key state variables and understand what went wrong? Are there useful log statements?
- **Testability**: Would a junior dev be able to write a test for this? Are side effects (API calls, file writes) separated from logic?

Suggest 3 concrete refactors.
```

### Prompt: Error Handling & Logging
**Use for:** Data pipelines, automation, integrations (especially Era Context, Supabase, Railway deployments)

```text
Review error handling in this code:

1. What can go wrong? (API timeouts, invalid responses, missing data, permission errors, etc.)
2. Does the code catch specific exceptions or just broad `Exception`? (Prefer specific.)
3. Does it retry on transient errors (network) vs fail fast on permanent errors (auth)?
4. Are errors logged with enough context? (What was the input? What was the state? What time did it fail?)
5. Does the error message tell you how to fix it, or just say "Error"?
6. If this is a scheduled task (cron), does it fail silently or alert you?

Flag critical gaps. Show a refactored exception handler.
```

---

## 🟢 TIER 3: Performance & Architecture

### Prompt: Performance & Efficiency
**Use for:** Trading bots, data feeds, content generation pipelines

```text
Review this code for efficiency:

1. **Loops & queries**: Is there any O(n^2) behavior or repeated API calls that could be batched?
2. **Data structures**: Are we using the right type? (dict lookup vs list search, set membership vs list contains, etc.)
3. **I/O**: Are we waiting for network/file operations synchronously when we could parallelize?
4. **Caching**: Are we re-fetching the same data repeatedly? Should we cache?
5. **Memory**: For large datasets, are we holding everything in memory or streaming?

If you spot waste, show the refactor. Include a rough estimate of time savings (10% faster, 2x fewer API calls, etc.).
```

### Prompt: Architecture & Testability
**Use for:** Multi-module systems (AEGIS, RELAY, content engine, trading bot orchestration)

```text
Review the architecture of this code:

1. **Separation of concerns**: Is business logic mixed with I/O? Can I test the core logic without mocking APIs?
2. **Dependencies**: Does this module depend on too many others? Is there a circular dependency?
3. **Interfaces**: If I wanted to swap out one component (e.g., Supabase for another DB), how hard would it be?
4. **Configuration**: Are environment-specific values (API keys, URLs, thresholds) externalized?
5. **Testing**: What would it take to unit test this? Are there pure functions I can test without side effects?

Suggest one structural refactor that would improve testability or modularity.
```

---

## 🔵 TIER 4: Specialized Reviews

### Prompt: Financial Data Security
**Use for:** Scripts handling balances, trades, account info, crypto wallets

```text
Review this code for financial data safety:

1. **Input validation**: Does it check that amounts are positive, account IDs are real, etc.?
2. **Logging & audit trail**: Does it log all transactions with timestamp, amount, and outcome? (You should never wonder "did that trade go through?")
3. **Idempotency**: If this runs twice accidentally, does it double-process? (e.g., buying the same stock twice)
4. **State consistency**: If a partial operation fails (bought stock but failed to log), can you recover?
5. **Secret handling**: Are API keys/tokens loaded from environment, never printed, never committed?
6. **Rounding**: Are you using integers (cents) or floats for money? (Floats break at scale.)

Highlight 2-3 risk areas and fixes.
```

### Prompt: API Integration Review
**Use for:** Code calling Era Context, yfinance, CoinGecko, Supabase, external APIs

```text
Review this API integration:

1. **Error handling**: Does it distinguish between client errors (400), auth errors (401), rate limits (429), and server errors (500)? Different strategies for each?
2. **Timeouts**: Does the request have a timeout? (API calls should never hang forever.)
3. **Rate limiting**: If calling this multiple times, does it respect rate limits? Backoff?
4. **Response validation**: Does it assume the API returns what it says, or does it validate the shape of the response?
5. **Documentation**: Is there a comment explaining the API's quirks, rate limit, or required headers?
6. **Testing**: Can you test this without hitting the real API? (Mock responses?)

Suggest one robustness improvement.
```

### Prompt: Deployment & DevOps Safety
**Use for:** Scripts running on Hermes (VPS), cron jobs, Railway deployments, Docker containers

```text
Review this code for production readiness:

1. **Configuration**: Are all env vars documented? Does the code fail fast if a required var is missing?
2. **Logging**: If this runs unattended, will you know if it failed? Are logs structured (JSON) for easy parsing?
3. **Exit codes**: Does the script exit with 0 on success and non-zero on failure? (Helps cron/monitoring tools detect problems.)
4. **Resource cleanup**: If this opens files, connections, or processes, does it close them? (Even on error?)
5. **Version pinning**: Are dependencies pinned (e.g., `requests==2.31.0`) or floating (e.g., `requests>=2.0`)? (Floating can break unexpectedly.)
6. **Secrets**: Are passwords/keys passed via env vars or config files, never hardcoded or as command-line args?

Flag any production risks.
```

---

## 🟣 TIER 5: Language-Specific Reviews

### Prompt: Python Review (Core Checks)
**Use for:** All Python scripts (AEGIS, bots, content automation, Army tools)

```text
Quick Python review:

- **Type hints**: Are function signatures annotated? (`def fetch_balance(account_id: str) -> float:`) Saves time debugging.
- **List comprehensions**: Any for-loops that could be a list comp or filter?
- **Context managers**: Any file or connection opens without `with`? (Risk of resource leak.)
- **f-strings**: Are you using `.format()` or `%` instead of f-strings?
- **Imports**: Are unused imports cluttering the top? Is anything imported but never used?
- **Docstrings**: Does each function/class have a docstring explaining intent, parameters, and return value?
- **PEP8**: Any obviously non-standard formatting? (80-120 char lines, snake_case for variables, etc.)

Flag 3 quick wins.
```

### Prompt: React/React Native Review (No Fomo, Thesis)
**Use for:** Expo/React Native (Thesis) or web components

```text
Review this React/React Native component:

1. **State management**: Is state overused? Could this be derived or lifted up?
2. **Prop drilling**: Are you passing props through 5 levels? Time to refactor or use context.
3. **Re-renders**: Are there unnecessary renders due to inline object/function creation? (Move to top-level or useMemo.)
4. **Hooks rules**: Are hooks called conditionally? (React requires top-level, non-conditional hooks.)
5. **Side effects**: Are side effects (API calls, subscriptions) wrapped in useEffect with proper cleanup?
6. **Accessibility**: Are interactive elements keyboard-accessible? Do images have alt text?
7. **Performance**: Are heavy lists using React.memo or virtualisation?

Suggest one refactor for clarity or performance.
```

### Prompt: TypeScript Type Safety
**Use for:** No Fomo, RELAY framework, any TS projects

```text
Review TypeScript types in this code:

1. **Any abuse**: Are there `any` types used to skip type checking? Replace with proper types.
2. **Union types**: Are you using `string | number` when an enum or const would be clearer?
3. **Nullable types**: Are optional properties handled? Do you check for undefined before accessing?
4. **Generics**: Are generic types clearly named? (`T` is vague; `AccountType` is clear.)
5. **Inference**: Is the type checker inferring correctly, or do you need explicit types?

Show the typed version of any untyped function.
```

---

## 🟠 Meta Prompts (For Reviewing Your Code Reviews)

### Prompt: "Am I Overthinking This?"
**Use to:** Sanity-check if a refactor is worth the effort

```text
I'm considering a refactor:
{DESCRIBE THE CHANGE}

Questions:
1. Does this fix a real bug or just make it "prettier"?
2. How much time would I save in the long run? (Minutes? Hours?)
3. Would I need to re-test everything, or is it safe?
4. If I don't do this, does the code still work?

Be honest: is this worth my time right now, or should I ship it as-is?
```

### Prompt: "What Should I Test?"
**Use for:** Deciding what test cases matter most

```text
What are the most critical test cases for this function?

{PASTE FUNCTION}

Prioritize by risk:
1. What's the worst thing that could go wrong in production?
2. What edge cases would hurt most if missed?
3. What's easy to test, hard to debug later?

Give me 3-5 test cases in plain English first, then show pytest syntax.
```

---

## 📋 Quick Checklist (Pre-Commit)

Before pushing code:

- [ ] Does it run without errors?
- [ ] Are there any hardcoded secrets (API keys, account IDs)?
- [ ] Would a teammate understand this without asking questions?
- [ ] Did I test the sad path? (What if the API fails? Empty input?)
- [ ] Are error messages helpful?
- [ ] Is there a comment explaining why (not just what)?
- [ ] Did I remove debug print statements?

---

## 🚀 Usage Tips

1. **Start with Tier 1** for any code touching money, auth, or critical logic.
2. **Use Tier 2** before merging to main or deploying.
3. **Use Tier 3** if performance matters (trading bots, data pipelines).
4. **Use Tier 4** for specialized domains (financial, API-heavy, deployment).
5. **Use Tier 5** for language-specific checks (Python, React, TS).
6. **Paste full function/file** — context helps catch subtle bugs.

---

## Integration with AEGIS & RELAY

**For AEGIS automation scripts:**
- Always run Tier 1 (Safety & Clarity) + Tier 4 (Financial Security)
- Log all financial operations; make them auditable

**For RELAY multi-agent orchestration:**
- Use Tier 3 (Architecture) to ensure handoffs between Haiku -> Sonnet -> Opus are clean
- Use Tier 4 (API Integration) for each MCP server call

**For content pipelines (Instagram, YouTube, content_engine.py):**
- Use Tier 1 + Tier 3 (Performance) to keep generation fast
- Ensure data_feed.py responses are validated (Tier 4: API Integration)

**For trading/investment bots:**
- Tier 1 + Tier 4 (Financial) + Tier 3 (Performance)
- Every trade must be logged with full context
