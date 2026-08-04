import sys
import json
import requests
import rasterio
import numpy as np
from rasterio.warp import calculate_default_transform, reproject, Resampling
from rasterio.io import MemoryFile

def fetch_and_process_dem(config):
    # Unpack config
    utm_bbox = config['utm_bbox'] # [xmin, ymin, xmax, ymax]
    target_epsg = config['target_epsg'] # e.g., 32616
    width = config['width']
    height = config['height']
    api_source = config['api_source'] # e.g., "SRTMGL1"
    api_key = config.get('api_key', '')
    output_path = config['output_path']

    # 1. Calculate Lat/Lon Bounds (WGS84) for API Query
    # We need to transform the 4 corners of the UTM bbox to Lat/Lon
    # For simplicity/robustness without heavy deps like pyproj if possible, 
    # but rasterio handles this well.
    
    # Create a dummy in-memory raster with the target bounds/crs to calculate transform
    dst_transform = rasterio.transform.from_bounds(*utm_bbox, width, height)
    dst_crs = rasterio.crs.CRS.from_epsg(target_epsg)

    # Calculate WGS84 bounds for query
    # We'll use warp.transform_bounds
    from rasterio.warp import transform_bounds
    wgs84_bounds = transform_bounds(dst_crs, {'init': 'epsg:4326'}, *utm_bbox)
    min_lon, min_lat, max_lon, max_lat = wgs84_bounds
    
    # Add a small buffer (approx 100m ~ 0.001 deg) to ensure we have coverage during warp
    buffer = 0.005
    min_lon -= buffer
    min_lat -= buffer
    max_lon += buffer
    max_lat += buffer

    print(f"Querying OpenTopography for area: {min_lon}, {min_lat}, {max_lon}, {max_lat}")

    # 2. Fetch Data from OpenTopography
    url = "https://portal.opentopography.org/API/globaldem"
    params = {
        'demtype': api_source,
        'south': min_lat,
        'north': max_lat,
        'west': min_lon,
        'east': max_lon,
        'outputFormat': 'GTiff',
        'API_Key': api_key
    }

    response = requests.get(url, params=params, stream=True)
    
    if response.status_code != 200:
        print(f"Error fetching DEM: {response.text}")
        sys.exit(1)

    # 3. Warp (Reproject & Resample) to Target Grid
    # We read the downloaded bytes directly into memory
    with MemoryFile(response.content) as memfile:
        with memfile.open() as src:
            # Prepare destination array
            destination = np.zeros((height, width), dtype=src.meta['dtype'])

            # Reproject
            reproject(
                source=rasterio.band(src, 1),
                destination=destination,
                src_transform=src.transform,
                src_crs=src.crs,
                dst_transform=dst_transform,
                dst_crs=dst_crs,
                resampling=Resampling.bilinear
            )

            # 4. Save Output
            out_meta = src.meta.copy()
            out_meta.update({
                "driver": "GTiff",
                "height": height,
                "width": width,
                "transform": dst_transform,
                "crs": dst_crs,
                "count": 1,
                "nodata": -9999 # Standardize nodata if needed, or keep src's
            })

            # Check for nodata in source and fill?
            # For now, let's respect the source nodata or default.
            
            with rasterio.open(output_path, "w", **out_meta) as dest:
                dest.write(destination, 1)

    print(f"Successfully generated DEM at {output_path}")

if __name__ == "__main__":
    try:
        # Input config passed as JSON string argument
        config_str = sys.argv[1]
        config = json.loads(config_str)
        fetch_and_process_dem(config)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
