import { CommandContext, Context } from "grammy";

export function helpCommand(ctx: CommandContext<Context>) {
  return ctx.reply(
    `OpenClaw Commands:\n\n` +
      `/start — Welcome & setup\n` +
      `/remind <text> — Quick reminder (e.g., /remind pick up milk at 5pm)\n` +
      `/schedule — View today's schedule\n` +
      `/family — Manage family members\n` +
      `/google — Connect Google Calendar & Gmail\n` +
      `/update — Self-update from GitHub (admin only)\n` +
      `/help — Show this message\n\n` +
      `Or just chat with me naturally!`
  );
}
