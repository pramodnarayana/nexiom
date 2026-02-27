# Integration Compliance Checklist

When adding a new integration by copying code from the open-source Activepieces repository, the following compliance steps **must** be completed.

## 1. Activepieces Attribution & Licensing

Because Activepieces is MIT-licensed, we are legally required to preserve their license and provide attribution when copying their code into the FluxNex monorepo.

Before submitting a Pull Request containing copied Activepieces integration code, verify:

- [ ] **License Preservation:** The original MIT license header (if present) remains at the top of the file or in the root of the copied module directory.
- [ ] **File-Level Attribution:** A comment has been added to the top of the main entry point (e.g., `index.ts` or `action.ts`) explicitly stating:

  ```typescript
  /**
   * Copyright (c) Activepieces
   * This code is adapted from the open-source Activepieces project (MIT License).
   * Original source: https://github.com/activepieces/activepieces
   */
  ```

- [ ] **Source Tracking:** The Pull Request description or a commit message explicitly records the source repository and the Git commit hash from which the code was copied.
