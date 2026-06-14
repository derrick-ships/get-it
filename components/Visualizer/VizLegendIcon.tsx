import type { VizType } from "@/lib/schemas";

import { VIZ_TYPE_META, vizTypeStyle } from "./viz-meta";

export default function VizLegendIcon({ type }: { type: VizType }) {
  const { Icon, label } = VIZ_TYPE_META[type];
  const tooltipId = `viz-legend-tooltip-${type}`;

  return (
    <span
      className="viz-tooltip-anchor viz-legend-icon"
      style={vizTypeStyle(type)}
      role="img"
      aria-label={label}
      aria-describedby={tooltipId}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span id={tooltipId} className="viz-tooltip" role="tooltip">
        {label}
      </span>
    </span>
  );
}
