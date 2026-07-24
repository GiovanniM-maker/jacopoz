import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName =
  | "home"
  | "search"
  | "create"
  | "community"
  | "profile"
  | "review"
  | "heart"
  | "back"
  | "settings"
  | "bookmark"
  | "close"
  | "list"
  | "star"
  | "trash"
  | "flag"
  | "download"
  | "bell";

interface Props {
  name: IconName;
  size?: number;
  color: string;
  /** Filled variant for the active tab (Netflix/Instagram style). */
  filled?: boolean;
}

// Clean 24x24 line icons — minimal, Netflix/Instagram aesthetic.
export function Icon({ name, size = 26, color, filled = false }: Props) {
  const stroke = color;
  const fill = filled ? color : "none";
  const sw = 1.9;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === "home" && (
        <>
          <Path
            d="M3 10.2 12 3l9 7.2"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M5.2 9v10.5A1.5 1.5 0 0 0 6.7 21h10.6a1.5 1.5 0 0 0 1.5-1.5V9"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={filled ? color : "none"}
          />
        </>
      )}

      {name === "search" && (
        <>
          <Circle cx={11} cy={11} r={7} stroke={stroke} strokeWidth={sw} />
          <Path d="M20 20l-3.5-3.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </>
      )}

      {name === "create" && (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={5} stroke={stroke} strokeWidth={sw} />
          <Path d="M12 8v8M8 12h8" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </>
      )}

      {name === "community" && (
        <Path
          d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-5.1A7.5 7.5 0 1 1 20 11.5Z"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          fill={fill}
        />
      )}

      {name === "heart" && (
        <Path
          d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          fill={fill}
        />
      )}

      {name === "review" && (
        <>
          <Path
            d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3Z"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
            fill={fill}
          />
          <Path d="M13.5 6.5l3 3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </>
      )}

      {name === "profile" && (
        <>
          <Circle cx={12} cy={8} r={4} stroke={stroke} strokeWidth={sw} fill={fill} />
          <Path
            d="M4.5 20a7.5 7.5 0 0 1 15 0"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill={fill}
          />
        </>
      )}

      {name === "back" && (
        <Path
          d="M15 4.5 7.5 12l7.5 7.5"
          stroke={stroke}
          strokeWidth={sw + 0.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {name === "settings" && (
        <>
          {/* Sliders: reads as "settings" at small sizes better than a cog.
              Square knobs — on-brand with the collana's hard corners. */}
          <Path d="M4 7h16M4 12h16M4 17h16" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <Rect x={7} y={4.8} width={4.4} height={4.4} fill={stroke} />
          <Rect x={13} y={9.8} width={4.4} height={4.4} fill={stroke} />
          <Rect x={5} y={14.8} width={4.4} height={4.4} fill={stroke} />
        </>
      )}

      {name === "bookmark" && (
        <Path
          d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4-6.5 4V4.5a1 1 0 0 1 1-1Z"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          fill={fill}
        />
      )}

      {name === "bell" && (
        <Path
          d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? fill : "none"}
        />
      )}

      {name === "download" && (
        <>
          <Path
            d="M12 3v11m0 0 4-4m-4 4-4-4"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {name === "close" && (
        <Path
          d="M6 6l12 12M18 6 6 18"
          stroke={stroke}
          strokeWidth={sw + 0.3}
          strokeLinecap="round"
        />
      )}

      {name === "list" && (
        <>
          <Path
            d="M9 6h12M9 12h12M9 18h12"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <Rect x={3} y={4.6} width={2.8} height={2.8} fill={stroke} />
          <Rect x={3} y={10.6} width={2.8} height={2.8} fill={stroke} />
          <Rect x={3} y={16.6} width={2.8} height={2.8} fill={stroke} />
        </>
      )}

      {name === "star" && (
        <Path
          d="m12 3 2.7 5.7 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.9 1.1-6.1L3.2 9.5l6.1-.8L12 3Z"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          fill={fill}
        />
      )}

      {name === "flag" && (
        <>
          <Path d="M6 21V4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <Path
            d="M6 5h12l-2.6 3.5L18 12H6"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
            fill={fill}
          />
        </>
      )}

      {name === "trash" && (
        <>
          <Path d="M4.5 6.5h15" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          <Path
            d="M9 6V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8V6"
            stroke={stroke}
            strokeWidth={sw}
          />
          <Path
            d="M6.5 6.5 7.3 20a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-13.5"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          <Path d="M10 10.5v7M14 10.5v7" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}
