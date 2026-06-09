"""
mqtt_service.py — MQTT publish integration using paho-mqtt v2.

Flow:
  1. Connect to broker on init
  2. publish(payload_dict) → serializes to JSON and publishes
  3. Auto-reconnect on disconnect
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class MQTTService:
    def __init__(self, runtime_config):
        self._rc = runtime_config
        self._client = None
        self._lock = threading.Lock()
        self._connected = False

    def connect(self) -> None:
        try:
            import paho.mqtt.client as mqtt

            client_id = self._rc.get("mqtt_client_id", "voiceguard-fraud-detector")
            self._client = mqtt.Client(
                client_id=client_id,
                protocol=mqtt.MQTTv5,
            )

            username = self._rc.get("mqtt_username", "")
            password = self._rc.get("mqtt_password", "")
            if username:
                self._client.username_pw_set(username, password or None)

            if self._rc.get("mqtt_use_tls", False):
                import ssl
                self._client.tls_set(tls_version=ssl.PROTOCOL_TLS)

            self._client.on_connect = self._on_connect
            self._client.on_disconnect = self._on_disconnect

            host = self._rc.get("mqtt_broker_host", "localhost")
            port = int(self._rc.get("mqtt_broker_port", 1883))
            self._client.connect_async(host, port, keepalive=60)
            self._client.loop_start()
            logger.info(f"[MQTT] Connecting to {host}:{port}")

        except ImportError:
            logger.error("[MQTT] paho-mqtt not installed")
        except Exception as e:
            logger.error(f"[MQTT] Connection failed: {e}")

    def disconnect(self) -> None:
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()
            self._connected = False

    def publish(self, payload: Dict[str, Any]) -> bool:
        if not self._client or not self._connected:
            logger.warning("[MQTT] Not connected, skipping publish")
            return False

        topic = self._rc.get("mqtt_topic", "voiceguard/fraud/alerts")
        qos = int(self._rc.get("mqtt_qos", 1))
        retain = bool(self._rc.get("mqtt_retain", False))

        try:
            json_payload = json.dumps(payload, ensure_ascii=False, default=str)
            result = self._client.publish(topic, json_payload, qos=qos, retain=retain)
            if result.rc == 0:
                logger.info(f"[MQTT] Published alert {payload.get('alert_id')} to {topic}")
                return True
            logger.warning(f"[MQTT] Publish failed rc={result.rc}")
            return False
        except Exception as e:
            logger.error(f"[MQTT] Publish error: {e}")
            return False

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        self._connected = reason_code == 0
        if self._connected:
            logger.info("[MQTT] Connected to broker")
        else:
            logger.warning(f"[MQTT] Connection refused: {reason_code}")

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties) -> None:
        self._connected = False
        logger.warning(f"[MQTT] Disconnected (rc={reason_code}), will auto-reconnect")

    @property
    def is_connected(self) -> bool:
        return self._connected
