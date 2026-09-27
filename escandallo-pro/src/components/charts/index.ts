/** Envoltorios de gráficos reutilizables (tema claro/oscuro, tooltips y accesibilidad incluidos). */
export { useChartTheme, statusColor, fmtEurAxis, STATUS_LEGEND, FIXED_COLORS, type ChartTheme } from './theme';
export { ChartTooltipBox, ChartLegend, ChartEmpty, SrTable } from './ChartParts';
export { HBarList, type HBarItem, type HBarTone } from './HBarList';
// Los gráficos con recharts se cargan bajo demanda (ver lazy.tsx); aquí sólo se reexportan sus tipos.
export { ColumnChart, TrendLine, QuadrantScatter, ChartSkeleton } from './lazy';
export type { ColumnDatum } from './ColumnChart';
export type { TrendPoint } from './TrendLine';
export type { QuadrantPoint, QuadrantGroup, QuadrantLabels } from './QuadrantScatter';
