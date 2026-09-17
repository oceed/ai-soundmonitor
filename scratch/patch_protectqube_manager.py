path = r"c:\Users\LENOVO\Documents\project\protectqube-ai\backend\app\camera\manager.py"
with open(path, "r", encoding="utf-8") as f:
    code = f.read()

target = """    def get_spatial_status(self, camera_id: str) -> dict:
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
            "timestamp": info.get("timestamp", time.time()),
            "last_updated": info.get("updated_at", 0),
        }"""

replacement = """    def get_spatial_status(self, camera_id: str, zone_id: str = None) -> dict:
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
                "timestamp": info.get("timestamp", time.time()),
                "last_updated": info.get("updated_at", 0),
            }

        return {
            "camera_id": camera_id,
            "customer_present": active_cs > 0,
            "active_customers": active_cs,
            "active_zones": active_zones,
            "occupancy": occupancy,
            "intrusion_active": spatial.get("intrusion_active", False),
            "crowd_active": spatial.get("crowd_active", False),
            "timestamp": info.get("timestamp", time.time()),
            "last_updated": info.get("updated_at", 0),
        }"""

if target in code:
    code = code.replace(target, replacement)
    with open(path, "w", encoding="utf-8") as f:
        f.write(code)
    print("[OK] manager.py patched successfully")
else:
    print("[WARN] target not found in manager.py")
