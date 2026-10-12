export const DIM_CONTRAST = 3;

const LCD_BG_SATURATION = 0.3;
const LCD_BG_LIGHTNESS = 6;
const DIM_SATURATION = 0.4;

function channel(fraction: number): number {
  const value = Math.round(fraction * 255) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function hslLuminance(hue: number, saturation: number, lightness: number): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const part = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return 0.2126 * channel(part(0)) + 0.7152 * channel(part(8)) + 0.0722 * channel(part(4));
}

export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function dimLightness(hue: number, saturation: number, target = DIM_CONTRAST): number {
  const background = hslLuminance(hue, saturation * LCD_BG_SATURATION, LCD_BG_LIGHTNESS);
  let low = LCD_BG_LIGHTNESS;
  let high = 100;
  for (let i = 0; i < 30; i++) {
    const middle = (low + high) / 2;
    if (contrastRatio(hslLuminance(hue, saturation * DIM_SATURATION, middle), background) >= target) high = middle;
    else low = middle;
  }
  return Math.ceil(high * 10) / 10;
}
