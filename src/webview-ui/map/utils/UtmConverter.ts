export class UtmConverter {
    // Ellipsoid constants (WGS84)
    private static readonly a = 6378137.0;
    private static readonly f = 1 / 298.257223563;
    private static readonly k0 = 0.9996;

    public static latLonToUtm(lat: number, lon: number, forceZone?: number | string): { x: number, y: number, zone: number, isNorth: boolean } {
        const phi = lat * Math.PI / 180;
        const lambda = lon * Math.PI / 180;

        let zone: number;
        if (forceZone) {
            zone = typeof forceZone === 'string' ? parseInt(forceZone) : forceZone;
        } else {
            zone = Math.floor((lon + 180) / 6.0) + 1;
        }
        const lambda0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;

        const e2 = 2 * this.f - this.f * this.f;
        const N = this.a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
        const T = Math.tan(phi) * Math.tan(phi);
        const C = e2 * Math.cos(phi) * Math.cos(phi) / (1 - e2);
        const A = (lambda - lambda0) * Math.cos(phi);

        const M = this.a * (
            (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi -
            (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi) +
            (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi) -
            (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi)
        );

        let x = this.k0 * N * (A + (1 - T + C) * A * A * A / 6 +
            (5 - 18 * T + T * T + 72 * C - 58 * e2) * A * A * A * A * A / 120);
        x += 500000; // False Easting

        let y = this.k0 * (M + N * Math.tan(phi) * (A * A / 2 +
            (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24 +
            (61 - 58 * T + T * T + 600 * C - 330 * e2) * A * A * A * A * A * A / 720));

        if (lat < 0) {
            y += 10000000; // False Northing for Southern Hemisphere
        }

        return { x, y, zone, isNorth: lat >= 0 };
    }

    public static utmToLatLon(x: number, y: number, zone: number | string, datum: string = 'WGS84', isNorth: boolean = true): { lat: number, lng: number } {
        // Handle Zone String (e.g., "16N")
        if (typeof zone === 'string') {
            isNorth = zone.toUpperCase().endsWith('N');
            zone = parseInt(zone);
        }

        // Ellipsoid Constants
        let a = this.a; // Default WGS84
        let f = this.f;

        if (datum === 'NAD83') {
            // GRS80 Ellipsoid
            a = 6378137.0;
            f = 1 / 298.257222101;
        }

        const k0 = this.k0;
        const e = Math.sqrt(2 * f - f * f); // Eccentricity
        const e1sq = e * e / (1 - e * e); // e' squared

        x = x - 500000;
        if (!isNorth) {
            y = y - 10000000;
        }

        const M = y / k0;
        const mu = M / (a * (1 - Math.pow(e, 2) / 4 - 3 * Math.pow(e, 4) / 64 - 5 * Math.pow(e, 6) / 256));

        const e1 = (1 - Math.sqrt(1 - Math.pow(e, 2))) / (1 + Math.sqrt(1 - Math.pow(e, 2)));

        const J1 = (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32);
        const J2 = (21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32);
        const J3 = (151 * Math.pow(e1, 3) / 96);
        const J4 = (1097 * Math.pow(e1, 4) / 512);

        const phi1 = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) + J3 * Math.sin(6 * mu) + J4 * Math.sin(8 * mu);

        const N1 = a / Math.sqrt(1 - Math.pow(e * Math.sin(phi1), 2));
        const R1 = a * (1 - Math.pow(e, 2)) / Math.pow(1 - Math.pow(e * Math.sin(phi1), 2), 1.5);
        const D = x / (N1 * k0);

        const Q1 = N1 * Math.tan(phi1) / R1;
        const Q2 = D * D / 2;
        const Q3 = (5 + 3 * Math.tan(phi1) * Math.tan(phi1) + 10 * J1 - 4 * J1 * J1 - 9 * e1sq) * Math.pow(D, 4) / 24;
        const Q4 = (61 + 90 * Math.tan(phi1) * Math.tan(phi1) + 298 * J1 + 45 * Math.tan(phi1) * Math.tan(phi1) * Math.tan(phi1) * Math.tan(phi1) - 252 * e1sq - 3 * J1 * J1) * Math.pow(D, 6) / 720;

        let lat = phi1 - Q1 * (Q2 - Q3 + Q4);


        const Q6 = (1 + 2 * Math.tan(phi1) * Math.tan(phi1) + J1) * Math.pow(D, 3) / 6;
        const Q7 = (5 - 2 * J1 + 28 * Math.tan(phi1) * Math.tan(phi1) - 3 * J1 * J1 + 8 * e1sq + 24 * Math.tan(phi1) * Math.tan(phi1) * Math.tan(phi1) * Math.tan(phi1)) * Math.pow(D, 5) / 120;

        let lng = (D - Q6 + Q7) / Math.cos(phi1);

        // Convert to degrees
        lat = lat * 180 / Math.PI;
        lng = lng * 180 / Math.PI;

        const centralMeridian = (zone - 1) * 6 - 180 + 3;
        lng = lng + centralMeridian;

        return { lat, lng };
    }
}
