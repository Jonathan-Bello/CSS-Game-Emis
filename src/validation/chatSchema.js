import { z } from "zod";

export const ChatSchema = z.object({
  message: z.string().min(1).max(1200),
  intent_mode: z.enum(["tutor_css", "guia_juego", "auto"]).optional(),
  player_context: z
    .object({
      screen: z.string().optional(),
      level: z.string().optional(),
      objective: z.string().optional(),
      unlocked_css: z.array(z.string()).optional(),
      zone_id: z.string().max(120).optional(),
      quest_id: z.string().max(120).optional(),
      quest_step: z.string().max(120).optional(),
      nearby_npcs: z.array(z.string().max(120)).max(20).optional(),
      available_portals: z.array(z.string().max(120)).max(20).optional(),
      inventory_tags: z.array(z.string().max(120)).max(40).optional(),
      failed_attempts_css: z.array(z.string().max(120)).max(30).optional(),
    })
    .optional(),
  css_snapshot_fragment: z.string().max(10000).optional(),
  css_snapshot: z.string().max(10000).optional(),
  conversation_id: z.string().max(120).optional(),
});
