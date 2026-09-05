/**
 * Google Maps' universal "get directions" URL scheme — no API key, and none of the Directions/
 * Routes API's caching or Google-basemap display restrictions apply, since this hands the route
 * off to Google entirely rather than fetching or rendering any of their data ourselves
 * (https://developers.google.com/maps/documentation/urls/get-started). This is how the app
 * outsources anything dynamic (transit schedules, fares) that it doesn't attempt to show itself.
 */
export function googleMapsDirectionsUrl(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
