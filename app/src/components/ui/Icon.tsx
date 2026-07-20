import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName =
  | "home"
  | "search"
  | "create"
  | "community"
  | "profile"
  | "review"
  | "heart";

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
    </Svg>
  );
}
