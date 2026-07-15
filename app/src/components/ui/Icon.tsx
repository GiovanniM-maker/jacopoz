import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName = "home" | "search" | "create" | "community" | "profile";

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
