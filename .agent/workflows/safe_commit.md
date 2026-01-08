---
description: Standard Git Commit Protocol
---

# Safe Commit Workflow

Before making a commit on any feature branch, you MUST ensure you are in sync with the main development line.

1.  **Sync with Development**:
    ```bash
    git pull origin development
    ```
2.  **Resolve Conflicts**: If any arise, resolve them immediately.
3.  **Commit**:
    ```bash
    git add .
    git commit -m "your message"
    ```
