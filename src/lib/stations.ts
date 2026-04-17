/**
 * Static Japanese train/subway station coordinate lookup.
 * Used to compute approximate anchor→restaurant distance for Tabelog results
 * without any API calls. Coverage targets major tourist/dining stations across
 * the six main metro areas (Tokyo, Osaka, Kyoto, Nagoya, Fukuoka, Sapporo).
 *
 * Keys match Tabelog's English station name format, WITHOUT the " Sta." suffix
 * (e.g. Tabelog shows "Shimbashi Sta. 337m" → key is "Shimbashi").
 * Add entries here as new stations are encountered.
 */

// [lat, lng] in WGS84
const STATIONS: Record<string, [number, number]> = {
  // ── Tokyo ───────────────────────────────────────────────────────────────────
  "Shinjuku":              [35.6895, 139.7006],
  "Nishi Shinjuku":        [35.6923, 139.6904],
  "Nishi-Shinjuku":        [35.6923, 139.6904],
  "Shinjuku Sanchome":     [35.6869, 139.7073],
  "Shinjuku Nishiguchi":   [35.6924, 139.6920],
  "Higashi Shinjuku":      [35.6929, 139.7121],
  "Shinjuku Gyoemmae":     [35.6862, 139.7097],
  "Shibuya":               [35.6581, 139.7015],
  "Harajuku":              [35.6697, 139.7025],
  "Meiji Jingumae":        [35.6693, 139.7030],
  "Omote Sando":           [35.6655, 139.7126],
  "Omotesando":            [35.6655, 139.7126],
  "Kita Sando":            [35.6727, 139.7077],
  "Yoyogi":                [35.6828, 139.7023],
  "Yoyogi Hachiman":       [35.6718, 139.6926],
  "Yoyogi Koen":           [35.6679, 139.6911],
  "Sangubashi":            [35.6775, 139.6997],
  "Nakameguro":            [35.6443, 139.6993],
  "Daikanyama":            [35.6487, 139.7032],
  "Ebisu":                 [35.6466, 139.7098],
  "Meguro":                [35.6334, 139.7157],
  "Shinagawa":             [35.6284, 139.7388],
  "Gotanda":               [35.6279, 139.7233],
  "Osaki":                 [35.6196, 139.7282],
  "Tamachi":               [35.6454, 139.7477],
  "Hamamatsucho":          [35.6559, 139.7574],
  "Roppongi":              [35.6629, 139.7312],
  "Nogizaka":              [35.6653, 139.7266],
  "Roppongi Itchome":      [35.6634, 139.7373],
  "Azabu Juban":           [35.6534, 139.7363],
  "Akasaka":               [35.6731, 139.7368],
  "Akasaka Mitsuke":       [35.6759, 139.7371],
  "Tameike Sanno":         [35.6741, 139.7426],
  "Kokkai Gijidomae":      [35.6742, 139.7434],
  "Kamiyacho":             [35.6655, 139.7437],
  "Toranomon":             [35.6668, 139.7487],
  "Toranomon Hills":       [35.6651, 139.7495],
  "Shimbashi":             [35.6659, 139.7578],
  "Ginza":                 [35.6714, 139.7636],
  "Ginza Itchome":         [35.6741, 139.7677],
  "Higashi Ginza":         [35.6693, 139.7648],
  "Tsukiji":               [35.6654, 139.7698],
  "Yurakucho":             [35.6752, 139.7629],
  "Hibiya":                [35.6740, 139.7594],
  "Kasumigaseki":          [35.6741, 139.7497],
  "Kyobashi":              [35.6774, 139.7714],
  "Nihonbashi":            [35.6825, 139.7750],
  "Tokyo":                 [35.6812, 139.7671],
  "Otemachi":              [35.6863, 139.7633],
  "Kanda":                 [35.6921, 139.7710],
  "Awajicho":              [35.6928, 139.7678],
  "Akihabara":             [35.6987, 139.7730],
  "Ueno":                  [35.7141, 139.7774],
  "Ueno Okachimachi":      [35.7110, 139.7741],
  "Naka Okachimachi":      [35.7079, 139.7792],
  "Shin Okachimachi":      [35.7109, 139.7817],
  "Asakusa":               [35.7116, 139.7966],
  "Asakusabashi":          [35.6978, 139.7879],
  "Kuramae":               [35.7027, 139.7919],
  "Morishita":             [35.6886, 139.7988],
  "Kiyosumi Shirakawa":    [35.6793, 139.7977],
  "Monzen Nakacho":        [35.6716, 139.7979],
  "Tsukishima":            [35.6655, 139.7827],
  "Ningyocho":             [35.6871, 139.7832],
  "Hatchobori":            [35.6730, 139.7789],
  "Shintomicho":           [35.6752, 139.7763],
  "Ikebukuro":             [35.7295, 139.7109],
  "Mejiro":                [35.7214, 139.7070],
  "Takadanobaba":          [35.7128, 139.7039],
  "Waseda":                [35.7087, 139.7199],
  "Higashi Ikebukuro":     [35.7284, 139.7193],
  "Komagome":              [35.7367, 139.7466],
  "Sugamo":                [35.7336, 139.7388],
  "Nishi Nippori":         [35.7331, 139.7687],
  "Nippori":               [35.7280, 139.7712],
  "Yotsuya":               [35.6867, 139.7300],
  "Ichigaya":              [35.6916, 139.7358],
  "Iidabashi":             [35.7019, 139.7449],
  "Suidobashi":            [35.7022, 139.7526],
  "Korakuen":              [35.7072, 139.7514],
  "Kasuga":                [35.7083, 139.7545],
  "Hongo Sanchome":        [35.7073, 139.7606],
  "Ochanomizu":            [35.6997, 139.7657],
  "Jimbocho":              [35.6965, 139.7575],
  "Kudanshita":            [35.6948, 139.7491],
  "Nagatcho":              [35.6741, 139.7414],
  "Ryogoku":               [35.6963, 139.7947],
  "Kinshicho":             [35.6983, 139.8135],
  "Hiroo":                 [35.6497, 139.7214],
  "Gaienmae":              [35.6711, 139.7152],
  "Aoyama Itchome":        [35.6719, 139.7218],
  "Minami Aoyama":         [35.6612, 139.7198],
  "Shirogane Takanawa":    [35.6426, 139.7283],
  "Shirokanedai":          [35.6375, 139.7249],
  "Mita":                  [35.6453, 139.7476],
  "Sengakuji":             [35.6356, 139.7402],
  "Osaki Hirokoji":        [35.6200, 139.7274],
  // ── Osaka ───────────────────────────────────────────────────────────────────
  "Umeda":                 [34.7024, 135.4959],
  "Osaka Umeda":           [34.7024, 135.4959],
  "Nishi Umeda":           [34.6990, 135.4958],
  "Higashi Umeda":         [34.7024, 135.5028],
  "Kitashinchi":           [34.6969, 135.4998],
  "Fukushima":             [34.7005, 135.4817],
  "Nakatsu":               [34.7143, 135.5069],
  "Minamimorimachi":       [34.7143, 135.5141],
  "Hommachi":              [34.6821, 135.5066],
  "Sakaisuji Hommachi":    [34.6813, 135.5139],
  "Yotsubashi":            [34.6726, 135.4967],
  "Shinsaibashi":          [34.6749, 135.5003],
  "Namba":                 [34.6658, 135.5010],
  "Namba (Osaka)":         [34.6658, 135.5010],
  "Nipponbashi":           [34.6639, 135.5090],
  "Daikokucho":            [34.6561, 135.5009],
  "Tengachaya":            [34.6424, 135.5043],
  "Shin Imamiya":          [34.6490, 135.5029],
  "Dobutsuen Mae":         [34.6515, 135.5075],
  "Tennoji":               [34.6466, 135.5128],
  "Tennoji Ekimae":        [34.6466, 135.5128],
  "Tanimachi Jucho":       [34.6649, 135.5167],
  "Tanimachi Yonchome":    [34.6820, 135.5158],
  "Tanimachi Rokuchome":   [34.6722, 135.5160],
  "Tanimachi Kyucho":      [34.6671, 135.5176],
  "Awaza":                 [34.6862, 135.4918],
  "Higobashi":             [34.6917, 135.4913],
  "Bentencho":             [34.6784, 135.4734],
  "Sakurajima":            [34.7079, 135.4384],
  "Universal City":        [34.6656, 135.4325],
  "Osaka":                 [34.7024, 135.4959],
  // ── Kyoto ───────────────────────────────────────────────────────────────────
  "Kyoto":                 [34.9862, 135.7582],
  "Tofukuji":              [34.9772, 135.7745],
  "Inari":                 [34.9672, 135.7726],
  "Gojo":                  [34.9968, 135.7559],
  "Karasuma Oike":         [35.0117, 135.7579],
  "Kyoto Shiyakusho Mae":  [35.0130, 135.7638],
  "Shijo":                 [35.0030, 135.7592],
  "Karasuma":              [35.0085, 135.7583],
  "Sanjo":                 [35.0115, 135.7688],
  "Sanjo Keihan":          [35.0111, 135.7711],
  "Gion Shijo":            [35.0033, 135.7729],
  "Kiyomizu Gojo":         [34.9965, 135.7748],
  "Marutamachi":           [35.0211, 135.7558],
  "Kuramaguchi":           [35.0311, 135.7558],
  "Imadegawa":             [35.0259, 135.7590],
  // ── Nagoya ──────────────────────────────────────────────────────────────────
  "Nagoya":                [35.1707, 136.8816],
  "Kokusai Center":        [35.1706, 136.8913],
  "Fushimi":               [35.1657, 136.8933],
  "Marunouchi":            [35.1679, 136.8981],
  "Sakae":                 [35.1693, 136.9086],
  "Shin Sakae":            [35.1725, 136.9142],
  "Osu Kannon":            [35.1579, 136.9007],
  "Kamimaezu":             [35.1531, 136.9007],
  "Kanayama":              [35.1450, 136.8979],
  // ── Fukuoka ─────────────────────────────────────────────────────────────────
  "Hakata":                [33.5900, 130.4204],
  "Gion":                  [33.5893, 130.4090],
  "Nakasu Kawabata":       [33.5946, 130.4104],
  "Tenjin":                [33.5900, 130.3980],
  "Tenjin Minami":         [33.5856, 130.3985],
  "Akasaka (Fukuoka)":     [33.5849, 130.3885],
  "Ohori Koen":            [33.5890, 130.3788],
  "Nishijin":              [33.5985, 130.3815],
  "Meinohama":             [33.5914, 130.3309],
  // ── Sapporo ─────────────────────────────────────────────────────────────────
  "Sapporo":               [43.0686, 141.3507],
  "Odori":                 [43.0619, 141.3539],
  "Susukino":              [43.0559, 141.3545],
  "Nakajima Koen":         [43.0490, 141.3518],
  "Horohira Bashi":        [43.0432, 141.3518],
  "Makomanai":             [42.9963, 141.3462],
  "Nishi 11 Chome":        [43.0613, 141.3320],
  "Nishi 18 Chome":        [43.0603, 141.3218],
  // ── Yokohama ────────────────────────────────────────────────────────────────
  "Yokohama":              [35.4657, 139.6222],
  "Kannai":                [35.4426, 139.6378],
  "Chinatown":             [35.4436, 139.6459],
  "Motomachi Chukagai":    [35.4436, 139.6459],
  "Ishikawacho":           [35.4363, 139.6404],
  "Sakuragicho":           [35.4518, 139.6318],
  "Minato Mirai":          [35.4564, 139.6353],
  "Bashamichi":            [35.4553, 139.6432],
  // ── Kobe ────────────────────────────────────────────────────────────────────
  "Sannomiya":             [34.6950, 135.1958],
  "Sannomiya (Hankyu)":    [34.6939, 135.1920],
  "Motomachi":             [34.6909, 135.1817],
  "Kobe":                  [34.6797, 135.1684],
  "Nada":                  [34.7131, 135.2430],
  "Mikage":                [34.7221, 135.2722],
  "Ashiya":                [34.7255, 135.3037],
};

/** Haversine distance between two WGS84 coordinates, in meters. */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Parse the station name from a Tabelog area/address string.
 * "Shimbashi Sta. 337m"     → "Shimbashi"
 * "Tennoji Ekimae Sta. 148m" → "Tennoji Ekimae"
 */
export function parseStationName(address: string): string | null {
  const m = address.match(/^(.+?)\s+Sta\./);
  return m ? m[1].trim() : null;
}

/**
 * Approximate total distance (meters) from the anchor to a Tabelog restaurant.
 *
 * anchor ──(Haversine)──► station ──(from listing)──► restaurant
 *
 * Returns null when the station is not found in the dataset.
 */
export function approximateAnchorDistance(
  address: string,
  stationToRestaurantMeters: number | null,
  anchorLat: number,
  anchorLng: number
): number | null {
  const name = parseStationName(address);
  if (!name) return null;
  const coords = STATIONS[name];
  if (!coords) return null;
  const anchorToStation = haversineMeters(anchorLat, anchorLng, coords[0], coords[1]);
  return Math.round(anchorToStation + (stationToRestaurantMeters ?? 0));
}
