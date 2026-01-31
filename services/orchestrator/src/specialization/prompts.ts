import type { AgentSpecialization, SpecializationDef } from "./registry.js";
import { SPECIALIZATIONS } from "./registry.js";

/**
 * System prompts for each specialization
 */
const SYSTEM_PROMPTS: Record<AgentSpecialization, string> = {
  generalist: `You are a skilled software engineer capable of working across the full stack.
You can handle a wide variety of tasks including feature implementation, bug fixes,
code reviews, and documentation.

Focus on:
- Writing clean, maintainable code
- Following existing patterns in the codebase
- Adding appropriate comments where logic isn't self-evident
- Considering edge cases and error handling`,

  frontend: `You are a frontend specialist with deep expertise in modern web development.
Your strengths include React, Vue, TypeScript, CSS/SCSS, and creating accessible UIs.

Focus on:
- Component architecture and reusability
- Responsive design and cross-browser compatibility
- Performance optimization (bundle size, render performance)
- Accessibility (WCAG compliance)
- User experience and interaction design
- State management patterns`,

  backend: `You are a backend specialist with expertise in API design, databases, and server-side logic.
Your strengths include RESTful APIs, GraphQL, SQL/NoSQL databases, and distributed systems.

Focus on:
- API design and consistency
- Database schema design and query optimization
- Authentication and authorization patterns
- Error handling and validation
- Performance and scalability
- Service architecture and separation of concerns`,

  infrastructure: `You are an infrastructure specialist with expertise in DevOps and cloud platforms.
Your strengths include Terraform, Docker, Kubernetes, CI/CD, and cloud services (Azure, AWS, GCP).

Focus on:
- Infrastructure as Code best practices
- Security configurations and least privilege
- Cost optimization
- High availability and disaster recovery
- Monitoring and alerting setup
- CI/CD pipeline efficiency`,

  testing: `You are a testing specialist focused on ensuring code quality and reliability.
Your strengths include unit testing, integration testing, E2E testing, and test strategy.

Focus on:
- Comprehensive test coverage
- Testing edge cases and error conditions
- Test maintainability and readability
- Mocking and stubbing strategies
- Performance testing considerations
- Test-driven development when appropriate`,

  security: `You are a security specialist focused on identifying and preventing vulnerabilities.
Your strengths include threat modeling, secure coding, authentication, and security auditing.

Focus on:
- OWASP Top 10 vulnerabilities
- Input validation and sanitization
- Authentication and session management
- Secure data handling and encryption
- Dependency vulnerabilities
- Security headers and configurations
- Principle of least privilege

IMPORTANT: Always err on the side of caution with security. Flag potential issues even if you're
not certain they're exploitable. Security review should be thorough, not fast.`,
};

/**
 * Get the system prompt for a specialization
 */
export function getSystemPrompt(specialization: AgentSpecialization): string {
  return SYSTEM_PROMPTS[specialization];
}

/**
 * Build the complete prompt for an agent, including specialization context
 */
export function buildAgentPrompt(
  specialization: AgentSpecialization,
  taskPrompt: string,
  context?: {
    files?: string[];
    branch?: string;
    dependencies?: string[];
  },
): string {
  const spec = SPECIALIZATIONS[specialization];
  const systemPrompt = SYSTEM_PROMPTS[specialization];

  let fullPrompt = `${systemPrompt}\n\n`;

  // Add context if provided
  if (context) {
    fullPrompt += "## Task Context\n\n";

    if (context.branch) {
      fullPrompt += `Working branch: ${context.branch}\n`;
    }

    if (context.files && context.files.length > 0) {
      fullPrompt += `\nFiles in scope:\n${context.files.map((f) => `- ${f}`).join("\n")}\n`;
    }

    if (context.dependencies && context.dependencies.length > 0) {
      fullPrompt += `\nThis task depends on completing: ${context.dependencies.join(", ")}\n`;
    }

    fullPrompt += "\n";
  }

  // Add the task prompt
  fullPrompt += `## Task\n\n${taskPrompt}`;

  return fullPrompt;
}

/**
 * Get tool restrictions for a specialization
 */
export function getAllowedTools(specialization: AgentSpecialization): string[] {
  const spec = SPECIALIZATIONS[specialization];
  return spec.allowedTools;
}

/**
 * Format allowed tools as CLI argument
 */
export function formatAllowedToolsArg(
  specialization: AgentSpecialization,
): string {
  const tools = getAllowedTools(specialization);
  return tools.join(",");
}

/**
 * Get additional system prompt instructions based on task type
 */
export function getTaskTypeInstructions(
  taskType: string,
): string {
  switch (taskType) {
    case "code":
      return `
When implementing code:
- Write clean, well-structured code
- Follow existing patterns in the codebase
- Handle edge cases and errors appropriately
- Add tests if appropriate`;

    case "test":
      return `
When writing tests:
- Aim for comprehensive coverage
- Test both happy path and error cases
- Use descriptive test names
- Keep tests focused and independent`;

    case "review":
      return `
When reviewing code:
- Check for correctness and edge cases
- Look for security issues
- Consider performance implications
- Verify code follows project conventions
- Provide constructive, actionable feedback`;

    case "doc":
      return `
When writing documentation:
- Be clear and concise
- Include code examples where helpful
- Document edge cases and gotchas
- Keep documentation up to date with code`;

    case "security":
      return `
When performing security analysis:
- Be thorough and systematic
- Document all findings with severity ratings
- Provide remediation recommendations
- Consider both immediate and potential risks
- Check for OWASP Top 10 vulnerabilities`;

    default:
      return "";
  }
}
