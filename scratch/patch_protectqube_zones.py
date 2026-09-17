import re

# 1. Patch spatial_service.py in ProtectQube AI
path_service = r"c:\Users\LENOVO\Documents\project\protectqube-ai\backend\app\services\spatial_service.py"
with open(path_service, "r", encoding="utf-8") as f:
    code = f.read()

if "active_cs_zones" not in code:
    code = code.replace(
        "active_cs_count = 0",
        "active_cs_count = 0\n        active_cs_by_zone = {}"
    )
    code = code.replace(
        "zone_active_count += 1\n                            active_cs_count += 1",
        "zone_active_count += 1\n                            active_cs_count += 1\n                            active_cs_by_zone[zone_id] = active_cs_by_zone.get(zone_id, 0) + 1"
    )
    code = code.replace(
        '"active_cs_customers":     active_cs_count,',
        '"active_cs_customers":     active_cs_count,\n            "active_cs_zones":         active_cs_by_zone,'
    )
    with open(path_service, "w", encoding="utf-8") as f:
        f.write(code)
    print("[OK] Successfully patched spatial_service.py")
else:
    print("spatial_service.py already has active_cs_zones")

# 2. Patch manager.py in ProtectQube AI
path_manager = r"c:\Users\LENOVO\Documents\project\protectqube-ai\backend\app\camera\manager.py"
with open(path_manager, "r", encoding="utf-8") as f:
    code_m = f.read()

old_func = """    def get_spatial_status(self, camera_id: str) -> dict:
        info = self._latest_spatial_status.get(camera_id, {})
        spatial = info.get("spatial") or {}
        active_cs = spatial.get("active_cs_customers", 0)
        occupancy = spatial.get("occupancy", 0)
        return {
            "camera_id": camera_id,
            "customer_present": active_cs > 0,
            "active_customers": active_cs,
            "occupancy": occupancy,
            "intrusion_active": spatial.get("intrusion_active", False),
            "crowd_active": spatial.get("crowd_active", False),
            "timestamp": info.get("timestamp", 0)
        }"""

new_func = """    def get_spatial_status(self, camera_id: str, zone_id: str = None) -> dict:
        info = self._latest_spatial_status.get(camera_id, {})
        spatial = info.get("spatial") or {}
        active_cs = spatial.get("active_cs_customers", 0)
        active_zones = spatial.get("active_cs_zones", {})
        occupancy = spatial.get("occupancy", 0)

        # If a specific Customer Service zone is requested (multi-counter single-camera setup)
        if zone_id:
            zone_count = active_zones.get(zone_id, 0)
            return {
                "camera_id": camera_id,
                "zone_id": zone_id,
                "customer_present": zone_count > 0,
                "active_customers": zone_count,
                "occupancy": occupancy,
                "intrusion_active": spatial.get("intrusion_active", False),
                "crowd_active": spatial.get("crowd_active", False),
                "timestamp": info.get("timestamp", 0)
            }

        return {
            "camera_id": camera_id,
            "customer_present": active_cs > 0,
            "active_customers": active_cs,
            "active_zones": active_zones,
            "occupancy": occupancy,
            "intrusion_active": spatial.get("intrusion_active", False),
            "crowd_active": spatial.get("crowd_active", False),
            "timestamp": info.get("timestamp", 0)
        }"""

if old_func in code_m:
    code_m = code_m.replace(old_func, new_func)
    with open(path_manager, "w", encoding="utf-8") as f:
        f.write(code_m)
    print("[OK] Successfully patched manager.py")
else:
    print("manager.py already updated or signature differs")

# 3. Patch api/spatial.py in ProtectQube AI
path_api = r"c:\Users\LENOVO\Documents\project\protectqube-ai\backend\app\api\spatial.py"
with open(path_api, "r", encoding="utf-8") as f:
    code_api = f.read()

old_api_func = """@public_spatial_router.get("/api/spatial/status/{camera_id}")
@spatial_router.get("/api/spatial/status/{camera_id}")
async def get_spatial_status(camera_id: str):
    \"\"\"
    Returns real-time customer presence and spatial status for VoiceGuard integration.
    Non-blocking, instant response from in-memory cache.
    \"\"\"
    if not _camera_manager:
        return JSONResponse({
            "camera_id": camera_id,
            "customer_present": False,
            "active_customers": 0,
            "occupancy": 0,
            "error": "Camera manager not ready"
        })
    status = _camera_manager.get_spatial_status(camera_id)
    return JSONResponse(status)"""

new_api_func = """@public_spatial_router.get("/api/spatial/status/{camera_id}")
@spatial_router.get("/api/spatial/status/{camera_id}")
async def get_spatial_status(camera_id: str, zone_id: str = None):
    \"\"\"
    Returns real-time customer presence and spatial status for VoiceGuard integration.
    Supports optional ?zone_id= query param for multi-desk single-camera mapping.
    Non-blocking, instant response from in-memory cache.
    \"\"\"
    if not _camera_manager:
        return JSONResponse({
            "camera_id": camera_id,
            "customer_present": False,
            "active_customers": 0,
            "occupancy": 0,
            "error": "Camera manager not ready"
        })
    status = _camera_manager.get_spatial_status(camera_id, zone_id=zone_id)
    return JSONResponse(status)"""

if old_api_func in code_api:
    code_api = code_api.replace(old_api_func, new_api_func)
    with open(path_api, "w", encoding="utf-8") as f:
        f.write(code_api)
    print("[OK] Successfully patched api/spatial.py")
else:
    print("api/spatial.py already updated or signature differs")
