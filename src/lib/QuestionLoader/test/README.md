# Question Loader Tests

Manual test scripts for question loaders.

## Available Tests

### Test All Loaders
Tests both ChgkInfoQuestionLoader and GotQuestionsOnlineLoader:
```bash
npm run test:loaders
```

### Test GotQuestions with Complexities
Tests GotQuestionsOnlineLoader with all complexity levels (random, easy, medium, hard):
```bash
npm run test:got-questions
```

## Requirements

- Node.js >= 20.x
- Environment variables (for hint generation test):
  - `OPENROUTER_API_KEY` (optional, only for hint testing)

## Test Files

- `test-loaders.ts` - Basic functionality test for both loaders
- `test-got-questions.ts` - Comprehensive test with complexity levels and hint generation
