# GitHub Copilot Custom Instructions

This file serves as a guide for GitHub Copilot to align with my coding style, project structure, and best practices. Use this as a reference for all code suggestions, edits, and implementations in this workspace.

## Coding Style Preferences

- **Language Conventions**:
  - **JavaScript/Node.js**: Use ES6+ syntax (arrow functions, async/await, destructuring). Prefer `const` over `let` where possible. Use camelCase for variables/functions, PascalCase for classes/components.
  - **Python**: Follow PEP 8. Use snake_case for variables/functions, PascalCase for classes. Prefer f-strings for string formatting. Use type hints where beneficial.
  - **General**: Consistent indentation (4 spaces for Python, 2 for JS). Add comments for complex logic, but keep code self-documenting.

- **File Structure**:
  - Keep files modular: one responsibility per file/module.
  - Use descriptive names for files, functions, and variables.
  - Organize imports: standard library first, then third-party, then local.

- **Code Patterns**:
  - Prefer functional programming where it improves readability (e.g., map/filter over loops).
  - Use async/await for asynchronous operations.
  - Handle errors gracefully with try/catch or proper exception handling.

## Change Guidelines

- **Incremental Changes**: Make small, targeted edits. Avoid rewriting entire files or functions unless explicitly requested.
- **Preserve Structure**: Maintain the existing project architecture, folder hierarchy, and file relationships. Only suggest structural changes if they significantly improve maintainability or performance.
- **Backwards Compatibility**: Ensure changes don't break existing functionality. Test implications before suggesting.
- **User Confirmation**: For major changes, explain the rationale and ask for approval.

## Best Practices

- **Performance**: Optimize for efficiency (e.g., avoid unnecessary loops, use efficient data structures).
- **Readability**: Write clear, concise code. Use meaningful variable names and add docstrings/comments for public APIs.
- **Maintainability**: Follow DRY (Don't Repeat Yourself). Refactor duplicated code.
- **Testing**: Suggest adding unit tests for new features. Use frameworks like Jest (JS) or pytest (Python).
- **Documentation**: Update READMEs or add JSDoc/Python docstrings for new functions.

## Security Checks

- **Input Validation**: Always validate and sanitize user inputs (e.g., check types, escape special characters).
- **Authentication/Authorization**: Ensure secure handling of credentials (never hardcode secrets; use environment variables).
- **Data Handling**: Protect sensitive data (e.g., encrypt where necessary, avoid logging passwords).
- **Dependencies**: Check for vulnerabilities in packages (e.g., via npm audit or safety).
- **Network Security**: Use HTTPS, validate SSL certificates, avoid insecure protocols.
- **Error Handling**: Don't expose sensitive information in error messages. Log securely.
- **Access Controls**: Implement proper permissions and rate limiting where applicable.

## Project-Specific Notes

- This is a multi-language project (JS, Python, etc.) with audio/voice processing features.
- Prioritize stability for real-time applications (e.g., voice synthesis).
- When suggesting changes, consider resource constraints (e.g., GPU/CPU usage in ML models).

## How to Use This File

- Reference this file in prompts when needed (e.g., "Follow the instructions in copilot-instructions.md").
- If a suggestion conflicts with these guidelines, prioritize the guidelines and explain why.
- Update this file as the project evolves or new preferences emerge.
