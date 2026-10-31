package com.appsleuth.argus.companion.ui

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.appsleuth.argus.companion.databinding.ItemFlightEventBinding
import com.appsleuth.argus.companion.model.FlightEvent
import com.appsleuth.argus.companion.model.Outcome

class FlightEventAdapter : ListAdapter<FlightEvent, FlightEventAdapter.EventViewHolder>(DIFF_CALLBACK) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): EventViewHolder {
        val binding = ItemFlightEventBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return EventViewHolder(binding)
    }

    override fun onBindViewHolder(holder: EventViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class EventViewHolder(private val binding: ItemFlightEventBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(event: FlightEvent) {
            binding.tvEventType.text = event.type.displayName
            try {
                binding.tvEventType.setBackgroundColor(Color.parseColor(event.type.colorHex))
            } catch (_: Exception) {}

            binding.tvEventLabel.text = event.shortLabel()

            val meta = buildString {
                append(event.formattedTime())
                event.durationMs?.let { append(" • ${it}ms") }
                if (event.sourceApp.isNotBlank() && event.sourceApp != "unknown") {
                    append(" • ${event.sourceApp.substringAfterLast(".")}")
                }
            }
            binding.tvEventMeta.text = meta

            binding.tvOutcome.text = when (event.outcome) {
                Outcome.SUCCESS -> "✅"
                Outcome.FAILURE -> "❌"
                Outcome.TIMEOUT -> "⏱️"
                Outcome.PENDING -> "⏳"
                Outcome.UNKNOWN -> "•"
            }
        }
    }

    companion object {
        private val DIFF_CALLBACK = object : DiffUtil.ItemCallback<FlightEvent>() {
            override fun areItemsTheSame(oldItem: FlightEvent, newItem: FlightEvent): Boolean =
                oldItem.id == newItem.id

            override fun areContentsTheSame(oldItem: FlightEvent, newItem: FlightEvent): Boolean =
                oldItem == newItem
        }
    }
}
