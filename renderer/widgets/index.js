import * as stat_card from "./stat_card.js";
import * as sparkline from "./sparkline.js";
import * as timeline from "./timeline.js";
import * as table from "./table.js";
import * as trace_waterfall from "./trace_waterfall.js";
import * as log_viewer from "./log_viewer.js";
import * as change_event_list from "./change_event_list.js";
import * as action_form from "./action_form.js";
import * as app_map from "./app_map.js";
import * as diff_view from "./diff_view.js";
import * as heatmap from "./heatmap.js";
import * as comparison_table from "./comparison_table.js";
import * as progress_tracker from "./progress_tracker.js";

export const widgets = {
  stat_card,
  sparkline,
  timeline,
  table,
  trace_waterfall,
  log_viewer,
  change_event_list,
  action_form,
  app_map,
  diff_view,
  heatmap,
  comparison_table,
  progress_tracker,
};

export const widgetTypes = Object.keys(widgets);
