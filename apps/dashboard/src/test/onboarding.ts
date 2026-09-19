// Realistic two-week onboarding definition: six emails with EN/ES locale,
// skip-after-activity guards, and an event-based stop. Captured from a dev database.
import type { WorkflowDefinition } from '../types';

export const onboardingDefinition = {
  "schemaVersion": "1",
  "description": "Two-week onboarding: six emails with EN/ES locale, skip connect/first-post steps after activity, and stop when several posts are queued.",
  "trigger": {
    "type": "manual"
  },
  "entryNodeId": "check_posts_queued_start",
  "purpose": "marketing",
  "topic": "onboarding",
  "nodes": [
    {
      "id": "check_posts_queued_start",
      "type": "branch",
      "onTrue": "end_habit_established",
      "onFalse": "check_already_connected",
      "condition": {
        "op": "event_received",
        "eventType": "posts.queued"
      }
    },
    {
      "id": "check_already_connected",
      "type": "branch",
      "onTrue": "wait_day1",
      "onFalse": "check_connected_field",
      "condition": {
        "op": "event_received",
        "eventType": "account.connected"
      }
    },
    {
      "id": "check_connected_field",
      "type": "branch",
      "onTrue": "wait_day1",
      "onFalse": "locale_welcome",
      "condition": {
        "op": "exists",
        "value": {
          "path": "contact.accountConnected"
        }
      }
    },
    {
      "id": "locale_welcome",
      "type": "branch",
      "onTrue": "send_welcome_es",
      "onFalse": "send_welcome_en",
      "condition": {
        "op": "eq",
        "left": {
          "path": "contact.locale",
          "default": "en"
        },
        "right": {
          "literal": "es"
        }
      }
    },
    {
      "id": "send_welcome_en",
      "next": "wait_day1",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "327532e0-70f8-4f33-8ff5-1b44e2c07ab2"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "send_welcome_es",
      "next": "wait_day1",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "20c630a7-b58e-4ffd-8ef5-2bc66dc41f5e"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "wait_day1",
      "type": "wait_for_event",
      "onEvent": "end_habit_established",
      "eventType": "posts.queued",
      "onTimeout": "check_scheduled_day1",
      "timeoutSeconds": 86400
    },
    {
      "id": "check_scheduled_day1",
      "type": "branch",
      "onTrue": "wait_day3",
      "onFalse": "check_connected_for_day1",
      "condition": {
        "op": "event_received",
        "eventType": "post.scheduled"
      }
    },
    {
      "id": "check_connected_for_day1",
      "type": "branch",
      "onTrue": "locale_day1",
      "onFalse": "check_connected_field_day1",
      "condition": {
        "op": "event_received",
        "eventType": "account.connected"
      }
    },
    {
      "id": "check_connected_field_day1",
      "type": "branch",
      "onTrue": "locale_day1",
      "onFalse": "wait_day3",
      "condition": {
        "op": "exists",
        "value": {
          "path": "contact.accountConnected"
        }
      }
    },
    {
      "id": "locale_day1",
      "type": "branch",
      "onTrue": "send_day1_es",
      "onFalse": "send_day1_en",
      "condition": {
        "op": "eq",
        "left": {
          "path": "contact.locale",
          "default": "en"
        },
        "right": {
          "literal": "es"
        }
      }
    },
    {
      "id": "send_day1_en",
      "next": "wait_day3",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "d0d9be2c-63ef-4716-8a42-9702ccfc25d0"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "send_day1_es",
      "next": "wait_day3",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "cac84060-7561-40ed-8545-80f2a5c5d3c4"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "wait_day3",
      "type": "wait_for_event",
      "onEvent": "end_habit_established",
      "eventType": "posts.queued",
      "onTimeout": "check_scheduled_day3",
      "timeoutSeconds": 172800
    },
    {
      "id": "check_scheduled_day3",
      "type": "branch",
      "onTrue": "wait_day5",
      "onFalse": "check_connected_for_day3",
      "condition": {
        "op": "event_received",
        "eventType": "post.scheduled"
      }
    },
    {
      "id": "check_connected_for_day3",
      "type": "branch",
      "onTrue": "locale_day3",
      "onFalse": "check_connected_field_day3",
      "condition": {
        "op": "event_received",
        "eventType": "account.connected"
      }
    },
    {
      "id": "check_connected_field_day3",
      "type": "branch",
      "onTrue": "locale_day3",
      "onFalse": "wait_day5",
      "condition": {
        "op": "exists",
        "value": {
          "path": "contact.accountConnected"
        }
      }
    },
    {
      "id": "locale_day3",
      "type": "branch",
      "onTrue": "send_day3_es",
      "onFalse": "send_day3_en",
      "condition": {
        "op": "eq",
        "left": {
          "path": "contact.locale",
          "default": "en"
        },
        "right": {
          "literal": "es"
        }
      }
    },
    {
      "id": "send_day3_en",
      "next": "wait_day5",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "1209f989-98dd-436c-9209-0917203a9417"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "send_day3_es",
      "next": "wait_day5",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "33ad77e7-befb-4f58-ab74-55f2ed63f673"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "wait_day5",
      "type": "wait_for_event",
      "onEvent": "end_habit_established",
      "eventType": "posts.queued",
      "onTimeout": "locale_day5",
      "timeoutSeconds": 172800
    },
    {
      "id": "locale_day5",
      "type": "branch",
      "onTrue": "send_day5_es",
      "onFalse": "send_day5_en",
      "condition": {
        "op": "eq",
        "left": {
          "path": "contact.locale",
          "default": "en"
        },
        "right": {
          "literal": "es"
        }
      }
    },
    {
      "id": "send_day5_en",
      "next": "wait_day8",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "bb63bc6b-ef6c-4b5a-aab2-6ba1013b7b09"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "send_day5_es",
      "next": "wait_day8",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "1353b62f-d4ee-447b-9e57-44e50dd1d384"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "wait_day8",
      "type": "wait_for_event",
      "onEvent": "end_habit_established",
      "eventType": "posts.queued",
      "onTimeout": "locale_day8",
      "timeoutSeconds": 259200
    },
    {
      "id": "locale_day8",
      "type": "branch",
      "onTrue": "send_day8_es",
      "onFalse": "send_day8_en",
      "condition": {
        "op": "eq",
        "left": {
          "path": "contact.locale",
          "default": "en"
        },
        "right": {
          "literal": "es"
        }
      }
    },
    {
      "id": "send_day8_en",
      "next": "wait_day14",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "a42b5527-26e8-487d-9cd1-39a8a4c8ddc9"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "send_day8_es",
      "next": "wait_day14",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "57991ed0-6377-4232-ac9b-3797dfecaa56"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "wait_day14",
      "type": "wait_for_event",
      "onEvent": "end_habit_established",
      "eventType": "posts.queued",
      "onTimeout": "check_active_day14",
      "timeoutSeconds": 518400
    },
    {
      "id": "check_active_day14",
      "type": "branch",
      "onTrue": "locale_day14_active",
      "onFalse": "locale_day14_restart",
      "condition": {
        "op": "event_received",
        "eventType": "post.scheduled"
      }
    },
    {
      "id": "locale_day14_active",
      "type": "branch",
      "onTrue": "send_day14_active_es",
      "onFalse": "send_day14_active_en",
      "condition": {
        "op": "eq",
        "left": {
          "path": "contact.locale",
          "default": "en"
        },
        "right": {
          "literal": "es"
        }
      }
    },
    {
      "id": "send_day14_active_en",
      "next": "end_completed",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "bf6669bb-eed4-4e9e-a76d-1fe2ed213091"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "send_day14_active_es",
      "next": "end_completed",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "bbb12d2e-e6c8-4888-aa2f-1e2e9509eb0e"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "locale_day14_restart",
      "type": "branch",
      "onTrue": "send_day14_restart_es",
      "onFalse": "send_day14_restart_en",
      "condition": {
        "op": "eq",
        "left": {
          "path": "contact.locale",
          "default": "en"
        },
        "right": {
          "literal": "es"
        }
      }
    },
    {
      "id": "send_day14_restart_en",
      "next": "end_completed",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "43dda282-c18f-42e4-ae98-623ea17336ad"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "send_day14_restart_es",
      "next": "end_completed",
      "type": "action",
      "input": {
        "templateVersionId": {
          "literal": "fcc7a7b3-2033-4721-952f-e1139a9dc01f"
        }
      },
      "action": "email.send",
      "onError": "attention"
    },
    {
      "id": "end_habit_established",
      "type": "end",
      "reason": "posts_queued"
    },
    {
      "id": "end_completed",
      "type": "end",
      "reason": "onboarding_completed"
    }
  ]
} satisfies WorkflowDefinition;
