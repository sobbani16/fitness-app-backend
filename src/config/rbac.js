// Shared required RBAC catalog for deployment seeding and readiness checks.
const ROLES = [
  { name: 'MEMBER', description: 'Standard app user — logs meals, workouts, uses Leo.' },
  { name: 'TRAINER', description: 'Certified trainer — manages clients, creates workout plans.' },
  { name: 'NUTRITIONIST', description: 'Certified nutritionist — creates meal plans, reviews food logs.' },
  { name: 'CREATOR', description: 'Recipe creator — publishes recipes, earns analytics.' },
  { name: 'SUPPORT', description: 'Customer support — view accounts, manage tickets.' },
  { name: 'ADMIN', description: 'Platform admin — manage users, trainers, recipes, analytics.' },
  { name: 'SUPER_ADMIN', description: 'Super admin — full platform control, audit logs, settings.' },
];

const PERMISSIONS = [
  // Member
  { name: 'VIEW_OWN_PROFILE', description: 'View own profile and data.' },
  { name: 'LOG_MEALS', description: 'Log meals and food.' },
  { name: 'LOG_WORKOUTS', description: 'Log workouts and exercises.' },
  { name: 'USE_AI_COACH', description: 'Chat with Leo AI coach.' },
  { name: 'VIEW_RECOMMENDATIONS', description: 'View meal/exercise recommendations.' },

  // Trainer
  { name: 'VIEW_CLIENTS', description: 'View assigned client list.' },
  { name: 'VIEW_CLIENT_PROGRESS', description: 'View client food logs, workouts, recovery.' },
  { name: 'VIEW_CLIENT_HEALTH', description: 'View client health conditions (with consent).' },
  { name: 'CREATE_WORKOUT_PLAN', description: 'Create and assign workout plans.' },
  { name: 'CREATE_COACH_NOTES', description: 'Write notes about clients.' },
  { name: 'ASSIGN_CLIENTS', description: 'Accept/manage client assignments.' },

  // Nutritionist
  { name: 'ASSIGN_MEAL_PLAN', description: 'Create and assign meal plans.' },
  { name: 'VIEW_FOOD_LOGS', description: 'View client food logs and macros.' },
  { name: 'VIEW_SUPPLEMENTS', description: 'View client supplement usage.' },
  { name: 'VIEW_HEALTH_CONDITIONS', description: 'View client conditions and allergies.' },

  // Creator
  { name: 'MANAGE_RECIPES', description: 'Create, edit, publish recipes.' },
  { name: 'VIEW_CREATOR_ANALYTICS', description: 'View recipe performance analytics.' },

  // Support
  { name: 'VIEW_USER_ACCOUNTS', description: 'View user account status.' },
  { name: 'VIEW_SUBSCRIPTIONS', description: 'View subscription info.' },
  { name: 'MANAGE_TICKETS', description: 'View and manage support tickets.' },

  // Admin
  { name: 'MANAGE_USERS', description: 'Create, edit, deactivate users.' },
  { name: 'MANAGE_ROLES', description: 'Assign and remove roles.' },
  { name: 'MANAGE_TRAINERS', description: 'Verify/manage trainer profiles.' },
  { name: 'MANAGE_NUTRITIONISTS', description: 'Verify/manage nutritionist profiles.' },
  { name: 'MANAGE_SUBSCRIPTIONS', description: 'Manage billing and subscriptions.' },
  { name: 'VIEW_PLATFORM_ANALYTICS', description: 'View platform-wide stats.' },

  // Super Admin
  { name: 'MANAGE_SUPER_ADMINS', description: 'Manage other super admins.' },
  { name: 'MANAGE_FEATURE_FLAGS', description: 'Toggle feature flags.' },
  { name: 'MANAGE_PLATFORM_SETTINGS', description: 'Edit platform configuration.' },
  { name: 'MANAGE_AI_SETTINGS', description: 'Configure AI/LLM parameters.' },
  { name: 'VIEW_AUDIT_LOGS', description: 'Access full audit trail.' },
  { name: 'MANAGE_BILLING_SETTINGS', description: 'Configure billing/payout settings.' },
];

// Maps role name → permission names
const ROLE_PERMISSIONS = {
  MEMBER: [
    'VIEW_OWN_PROFILE', 'LOG_MEALS', 'LOG_WORKOUTS', 'USE_AI_COACH', 'VIEW_RECOMMENDATIONS',
  ],
  TRAINER: [
    'VIEW_OWN_PROFILE', 'VIEW_CLIENTS', 'VIEW_CLIENT_PROGRESS', 'VIEW_CLIENT_HEALTH',
    'CREATE_WORKOUT_PLAN', 'CREATE_COACH_NOTES', 'ASSIGN_CLIENTS', 'USE_AI_COACH',
  ],
  NUTRITIONIST: [
    'VIEW_OWN_PROFILE', 'VIEW_CLIENTS', 'VIEW_CLIENT_PROGRESS', 'VIEW_CLIENT_HEALTH',
    'ASSIGN_MEAL_PLAN', 'VIEW_FOOD_LOGS', 'VIEW_SUPPLEMENTS', 'VIEW_HEALTH_CONDITIONS',
    'CREATE_COACH_NOTES', 'USE_AI_COACH',
  ],
  CREATOR: [
    'VIEW_OWN_PROFILE', 'MANAGE_RECIPES', 'VIEW_CREATOR_ANALYTICS',
  ],
  SUPPORT: [
    'VIEW_OWN_PROFILE', 'VIEW_USER_ACCOUNTS', 'VIEW_SUBSCRIPTIONS', 'MANAGE_TICKETS',
  ],
  ADMIN: [
    'VIEW_OWN_PROFILE', 'MANAGE_USERS', 'MANAGE_ROLES', 'MANAGE_TRAINERS',
    'MANAGE_NUTRITIONISTS', 'MANAGE_SUBSCRIPTIONS', 'VIEW_PLATFORM_ANALYTICS',
    'MANAGE_RECIPES', 'VIEW_AUDIT_LOGS',
  ],
  SUPER_ADMIN: [
    'VIEW_OWN_PROFILE', 'MANAGE_USERS', 'MANAGE_ROLES', 'MANAGE_TRAINERS',
    'MANAGE_NUTRITIONISTS', 'MANAGE_SUBSCRIPTIONS', 'VIEW_PLATFORM_ANALYTICS',
    'MANAGE_RECIPES', 'VIEW_AUDIT_LOGS', 'MANAGE_SUPER_ADMINS',
    'MANAGE_FEATURE_FLAGS', 'MANAGE_PLATFORM_SETTINGS', 'MANAGE_AI_SETTINGS',
    'MANAGE_BILLING_SETTINGS',
  ],
};


module.exports = { ROLES, PERMISSIONS, ROLE_PERMISSIONS };
