import * as stat_card from "./stat_card.js";
import * as sparkline from "./sparkline.js";
import * as timeline from "./timeline.js";
import * as table from "./table.js";
import * as trace_waterfall from "./trace_waterfall.js";
import * as log_viewer from "./log_viewer.js";
import * as change_event_list from "./change_event_list.js";
import * as action_form from "./action_form.js";

export const widgets = {
  stat_card,
  sparkline,
  timeline,
  table,
  trace_waterfall,
  log_viewer,
  change_event_list,
  action_form,
};

export const widgetTypes = Object.keys(widgets);
