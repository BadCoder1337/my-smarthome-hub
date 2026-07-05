#pragma once
#include <vector>
#include "esphome/core/component.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/remote_base/remote_base.h"
#include "esphome/components/binary_sensor/binary_sensor.h"

namespace esphome {
namespace rf_capture {

// Декодирует пульты (стандартный PT2262) в 24-битный код и поднимает кнопку
// по младшему ниблу (зеркально для всех пультов). Момент нажатия —
// publish(true) + авто-off через hold_time. Тайминги конфигурируются из YAML.
class RFCapture : public Component, public remote_base::RemoteReceiverListener {
 public:
  void set_led_pin(GPIOPin *pin) { this->led_pin_ = pin; }
  void set_bit_threshold(int32_t v) { this->bit_threshold_ = v; }
  void set_min_pulse(int32_t v) { this->min_pulse_ = v; }
  void set_max_pulse(int32_t v) { this->max_pulse_ = v; }
  void set_hold_time(uint32_t v) { this->hold_time_ = v; }
  void set_min_repeats(uint8_t v) { this->min_repeats_ = v; }
  void set_button(uint8_t nibble, binary_sensor::BinarySensor *s) {
    if (nibble < 16)
      this->map_[nibble] = s;
  }
  // Разрешённые пульты по 20-битному ID (старшие биты кода). Пусто = принимать любой.
  void add_remote(uint32_t id) { this->remotes_.push_back(id); }
  bool remote_allowed_(uint32_t id) {
    if (this->remotes_.empty())
      return true;
    for (uint32_t r : this->remotes_)
      if (r == id)
        return true;
    return false;
  }

  void setup() override {
    if (this->led_pin_ != nullptr) {
      this->led_pin_->setup();
      this->led_pin_->digital_write(false);
    }
  }

  void loop() override {
    if (this->led_on_ && this->led_pin_ != nullptr && millis() - this->led_since_ > 90) {
      this->led_pin_->digital_write(false);
      this->led_on_ = false;
    }
  }

  // Публичный вход: поднять кнопку по ниблу (зовётся и из декодера, и из raw-сенсоров).
  void fire_nibble(uint8_t nibble) {
    if (nibble >= 16 || this->map_[nibble] == nullptr)
      return;
    binary_sensor::BinarySensor *s = this->map_[nibble];
    s->publish_state(true);
    this->set_timeout("off" + std::to_string(nibble), this->hold_time_,
                      [s]() { s->publish_state(false); });
    if (this->led_pin_ != nullptr) {
      this->led_pin_->digital_write(true);
      this->led_on_ = true;
      this->led_since_ = millis();
    }
  }

  bool on_receive(remote_base::RemoteReceiveData data) override {
    int32_t n = data.size();
    if (n < 20)
      return false;

    // PT2262/EV1527: бит = (метка, пауза). длинн.-коротк.=1, коротк.-длинн.=0.
    // sync (обе длинные) невалиден → сброс. min/max_pulse отсекают мусор.
    uint64_t cur = 0;
    int bits = 0;
    uint64_t best = 0;
    int best_bits = 0;
    for (int32_t i = 0; i + 1 < n;) {
      int32_t m = data[i];
      int32_t s = data[i + 1];
      if (m > this->min_pulse_ && m < this->max_pulse_ && s < -this->min_pulse_ &&
          s > -this->max_pulse_) {
        bool m_long = m > this->bit_threshold_;
        bool s_long = (-s) > this->bit_threshold_;
        if (m_long != s_long) {
          cur = (cur << 1) | (m_long ? 1 : 0);
          bits++;
          if (bits > best_bits) {
            best_bits = bits;
            best = cur;
          }
          i += 2;
          continue;
        }
      }
      cur = 0;
      bits = 0;
      i += 1;
    }

    if (best_bits < 24)
      return false;
    uint32_t code = (uint32_t) (best & 0xFFFFFFULL);

    // Только свои пульты (иначе чужой PT2262 с тем же ниблом дёргал бы свет).
    if (!this->remote_allowed_(code >> 4))
      return false;

    // Подтверждение: min_repeats одинаковых декодов подряд (кадр идёт пачкой).
    // min_repeats=1 — срабатывать с первого валидного декода: максимум
    // чувствительности к слабым/дальним пультам (whitelist по ID защищает
    // от ложных). Поднять до 2, если появятся ложные срабатывания от шума.
    uint32_t now = millis();
    if (code == this->last_code_ && now - this->last_code_ms_ < 700)
      this->repeat_count_++;
    else
      this->repeat_count_ = 1;
    this->last_code_ = code;
    this->last_code_ms_ = now;
    if (this->repeat_count_ >= this->min_repeats_)
      this->fire_nibble((uint8_t) (code & 0xF));
    return true;
  }

 protected:
  GPIOPin *led_pin_{nullptr};
  binary_sensor::BinarySensor *map_[16]{};
  std::vector<uint32_t> remotes_;
  int32_t bit_threshold_{450};
  int32_t min_pulse_{150};
  int32_t max_pulse_{1000};
  uint32_t hold_time_{250};
  uint8_t min_repeats_{1};
  uint16_t repeat_count_{0};
  uint32_t last_code_{0xFFFFFFFF};
  uint32_t last_code_ms_{0};
  uint32_t led_since_{0};
  bool led_on_{false};
};

}  // namespace rf_capture
}  // namespace esphome
