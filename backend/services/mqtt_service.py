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
    def __init__(self, runtime_config, counter_id: Optional[str] = None):
        self._rc = runtime_config
        self._counter_id = counter_id
        self._client = None
        self._lock = threading.Lock()
        self._connected = False

    def connect(self) -> None:
        try:
            import paho.mqtt.client as mqtt

            base_client_id = self._rc.get("mqtt_client_id", "voiceguard-fraud-detector")
            client_id = f"{base_client_id}-{self._counter_id}" if self._counter_id else base_client_id
            username = self._rc.get("mqtt_username", "")
            password = self._rc.get("mqtt_password", "")
            host = self._rc.get("mqtt_broker_host", "72.60.78.162")
            port = int(self._rc.get("mqtt_broker_port", 1883))

            logger.info(f"[MQTT] Initiating connection to broker -> Host: {host}, Port: {port}, ClientID: {client_id}, Username: '{username}'")

            # Support paho-mqtt v1 & v2 API callback versions
            try:
                if hasattr(mqtt, "CallbackAPIVersion"):
                    self._client = mqtt.Client(
                        callback_api_version=mqtt.CallbackAPIVersion.VERSION1,
                        client_id=client_id,
                        protocol=mqtt.MQTTv311,
                    )
                else:
                    self._client = mqtt.Client(
                        client_id=client_id,
                        protocol=mqtt.MQTTv311,
                    )
            except Exception as ex_init:
                logger.warning(f"[MQTT] Client init fallback: {ex_init}")
                self._client = mqtt.Client(client_id=client_id)

            if username:
                self._client.username_pw_set(username, password or None)

            if self._rc.get("mqtt_use_tls", False):
                import ssl
                self._client.tls_set(tls_version=ssl.PROTOCOL_TLS)

            self._client.on_connect = self._on_connect
            self._client.on_disconnect = self._on_disconnect
            self._client.on_log = self._on_log

            # Synchronous connect test / async loop start
            self._client.connect_async(host, port, keepalive=60)
            self._client.loop_start()
            logger.info(f"[MQTT] Background network loop started for {host}:{port}")

        except ImportError:
            logger.error("[MQTT] paho-mqtt package is not installed")
        except Exception as e:
            logger.error(f"[MQTT] Connection setup failed: {e}", exc_info=True)

    def disconnect(self) -> None:
        if self._client:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception as e:
                logger.warning(f"[MQTT] Error during disconnect: {e}")
            self._connected = False
            logger.info("[MQTT] Disconnected from broker")

    def publish(self, payload: Dict[str, Any]) -> bool:
        if not self._client or not self._connected:
            logger.warning(f"[MQTT] Skipping publish alert {payload.get('alert_id')}: Broker NOT connected (Host: {self._rc.get('mqtt_broker_host')})")
            return False

        topic = self._rc.get("mqtt_topic", "voiceguard/fraud/alerts")
        qos = int(self._rc.get("mqtt_qos", 1))
        retain = bool(self._rc.get("mqtt_retain", False))

        try:
            json_payload = json.dumps(payload, ensure_ascii=False, default=str)
            result = self._client.publish(topic, json_payload, qos=qos, retain=retain)
            if result.rc == 0:
                logger.info(f"[MQTT SUCCESS] Published alert {payload.get('alert_id')} to topic '{topic}' (QoS {qos})")
                return True
            logger.warning(f"[MQTT ERROR] Publish failed with return code {result.rc} to topic '{topic}'")
            return False
        except Exception as e:
            logger.error(f"[MQTT ERROR] Exception publishing alert {payload.get('alert_id')}: {e}")
            return False

    def publish_normal(self, payload: Dict[str, Any], topic: Optional[str] = None) -> bool:
        if not self._client or not self._connected:
            logger.warning(f"[MQTT] Skipping publish normal event {payload.get('segment_id')}: Broker NOT connected (Host: {self._rc.get('mqtt_broker_host')})")
            return False

        target_topic = topic or self._rc.get("mqtt_normal_topic", "voiceguard/normal/events")
        qos = int(self._rc.get("mqtt_qos", 1))

        try:
            json_payload = json.dumps(payload, ensure_ascii=False, default=str)
            result = self._client.publish(target_topic, json_payload, qos=qos)
            if result.rc == 0:
                logger.info(f"[MQTT SUCCESS] Published normal event {payload.get('segment_id')} to topic '{target_topic}'")
                return True
            logger.warning(f"[MQTT ERROR] Publish normal event failed with return code {result.rc}")
            return False
        except Exception as e:
            logger.error(f"[MQTT ERROR] Exception publishing normal event: {e}")
            return False

    def _on_log(self, client, userdata, level, buf):
        # Log internal paho-mqtt client events (warnings/errors/connects)
        if "error" in buf.lower() or "fail" in buf.lower() or "refus" in buf.lower() or "disconnect" in buf.lower():
            logger.warning(f"[MQTT Log] {buf}")
        else:
            logger.debug(f"[MQTT Log] {buf}")

    def _on_connect(self, client, userdata, flags, rc, properties=None) -> None:
        RC_EXPLANATIONS = {
            0: "0: Connection Accepted (Success)",
            1: "1: Connection Refused: Unacceptable Protocol Version",
            2: "2: Connection Refused: Identifier Rejected",
            3: "3: Connection Refused: Server Unavailable",
            4: "4: Connection Refused: Bad Username or Password",
            5: "5: Connection Refused: Not Authorized",
        }
        try:
            rc_num = int(rc) if hasattr(rc, "__int__") else (rc.value if hasattr(rc, "value") else rc)
        except Exception:
            rc_num = rc

        self._connected = (rc_num == 0 or str(rc) == "Success")
        explanation = RC_EXPLANATIONS.get(rc_num, f"Return Code: {rc}")

        if self._connected:
            logger.info(f"[MQTT CONNECTED] Successfully connected to broker {self._rc.get('mqtt_broker_host')}:{self._rc.get('mqtt_broker_port')} -> {explanation}")
        else:
            logger.error(f"[MQTT REFUSED] Connection refused by broker {self._rc.get('mqtt_broker_host')}:{self._rc.get('mqtt_broker_port')} -> {explanation}")

    def _on_disconnect(self, client, userdata, disconnect_flags=None, rc=None, properties=None) -> None:
        self._connected = False
        logger.warning(f"[MQTT DISCONNECTED] Lost connection to broker {self._rc.get('mqtt_broker_host')}:{self._rc.get('mqtt_broker_port')} (Reason Code: {rc}). Will attempt auto-reconnect...")

    @property
    def is_connected(self) -> bool:
        return self._connected
