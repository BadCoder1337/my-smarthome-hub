import esphome.codegen as cg
import esphome.config_validation as cv
from esphome import pins
from esphome.components import binary_sensor
from esphome.components.remote_base import RemoteReceiverBase, RemoteReceiverListener
from esphome.const import CONF_ID

DEPENDENCIES = ["remote_base", "binary_sensor"]

rf_capture_ns = cg.esphome_ns.namespace("rf_capture")
RFCapture = rf_capture_ns.class_("RFCapture", cg.Component, RemoteReceiverListener)

CONF_RECEIVER_ID = "receiver_id"
CONF_LED_PIN = "led_pin"
CONF_BUTTONS = "buttons"
CONF_NIBBLE = "nibble"
CONF_SENSOR = "sensor"
CONF_REMOTES = "remotes"
CONF_BIT_THRESHOLD = "bit_threshold"
CONF_MIN_PULSE = "min_pulse"
CONF_MAX_PULSE = "max_pulse"
CONF_HOLD_TIME = "hold_time"
CONF_MIN_REPEATS = "min_repeats"

BUTTON_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NIBBLE): cv.int_range(min=0, max=15),
        cv.Required(CONF_SENSOR): cv.use_id(binary_sensor.BinarySensor),
    }
)

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(RFCapture),
        cv.Required(CONF_RECEIVER_ID): cv.use_id(RemoteReceiverBase),
        cv.Optional(CONF_LED_PIN): pins.gpio_output_pin_schema,
        cv.Optional(CONF_REMOTES, default=[]): cv.ensure_list(cv.hex_int),
        cv.Optional(
            CONF_BIT_THRESHOLD, default="450us"
        ): cv.positive_time_period_microseconds,
        cv.Optional(CONF_MIN_PULSE, default="150us"): cv.positive_time_period_microseconds,
        cv.Optional(CONF_MAX_PULSE, default="1000us"): cv.positive_time_period_microseconds,
        cv.Optional(CONF_HOLD_TIME, default="250ms"): cv.positive_time_period_milliseconds,
        cv.Optional(CONF_MIN_REPEATS, default=1): cv.int_range(min=1, max=10),
        cv.Required(CONF_BUTTONS): cv.ensure_list(BUTTON_SCHEMA),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    if CONF_LED_PIN in config:
        led = await cg.gpio_pin_expression(config[CONF_LED_PIN])
        cg.add(var.set_led_pin(led))

    cg.add(var.set_bit_threshold(config[CONF_BIT_THRESHOLD]))
    cg.add(var.set_min_pulse(config[CONF_MIN_PULSE]))
    cg.add(var.set_max_pulse(config[CONF_MAX_PULSE]))
    cg.add(var.set_hold_time(config[CONF_HOLD_TIME]))
    cg.add(var.set_min_repeats(config[CONF_MIN_REPEATS]))

    receiver = await cg.get_variable(config[CONF_RECEIVER_ID])
    cg.add(receiver.register_listener(var))

    for rid in config[CONF_REMOTES]:
        cg.add(var.add_remote(rid))

    for b in config[CONF_BUTTONS]:
        s = await cg.get_variable(b[CONF_SENSOR])
        cg.add(var.set_button(b[CONF_NIBBLE], s))
