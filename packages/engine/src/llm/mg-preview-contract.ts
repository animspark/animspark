import { z } from 'zod';

const second = z.number().finite().nonnegative();
/** Which frames `anim look` shoots: one time, a list, or an interval at an fps. */
export const mgPreviewRequestSchema = z.object({
  project: z.string().min(1).optional(),
  at: second.optional(),
  times: z.array(second).min(1).max(40).optional(),
  time: z.tuple([second, second]).optional(),
  from: second.optional(),
  to: second.optional(),
  fps: z.number().finite().positive().max(30).optional(),
  cols: z.number().int().min(1).max(8).optional(),
}).strict().superRefine((value, ctx) => {
  const interval = value.time !== undefined || value.from !== undefined || value.to !== undefined || value.fps !== undefined;
  if (Number(value.at !== undefined) + Number(value.times !== undefined) + Number(interval) > 1)
    ctx.addIssue({ code: 'custom', message: 'Choose at, times, or an interval.' });
  if (value.time && (value.from !== undefined || value.to !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Choose time or from/to.' });
  const from = value.time?.[0] ?? value.from ?? 0, to = value.time?.[1] ?? value.to;
  if (to !== undefined && to <= from) ctx.addIssue({ code: 'custom', message: 'Preview end must be after start.' });
});
export type MgPreviewRequest = z.infer<typeof mgPreviewRequestSchema>;
