package com.aasc.asr

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import kotlin.math.max

/**
 * 原生录音音量折线图。
 *
 * 只接收已经压缩后的音量包络，不持有 PCM，避免长录音时图表额外占用大量内存。
 */
class VolumeChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    private val density = resources.displayMetrics.density
    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFD7D7D7.toInt()
        style = Paint.Style.STROKE
        strokeWidth = density
    }
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF1976D2.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2.0f * density
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF555555.toInt()
        textSize = 12.0f * density
    }
    private var volumePoints: List<Float> = emptyList()

    fun setVolumePoints(points: List<Float>) {
        volumePoints = points.map { it.coerceIn(0.0f, 1.0f) }
        invalidate()
    }

    fun clear() {
        setVolumePoints(emptyList())
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val left = 34.0f * density
        val top = 16.0f * density
        val right = width.toFloat() - 12.0f * density
        val bottom = height.toFloat() - 20.0f * density
        val plotWidth = max(1.0f, right - left)
        val plotHeight = max(1.0f, bottom - top)

        for (step in 0..4) {
            val ratio = step / 4.0f
            val y = bottom - plotHeight * ratio
            canvas.drawLine(left, y, right, y, gridPaint)
            canvas.drawText(String.format("%.1f", ratio), 4.0f * density, y + 4.0f * density, labelPaint)
        }

        if (volumePoints.isEmpty()) {
            canvas.drawText("录音后显示完整音量曲线", left, top + plotHeight / 2.0f, labelPaint)
            return
        }

        val path = Path()
        val denominator = max(1, volumePoints.size - 1)
        volumePoints.forEachIndexed { index, value ->
            val x = left + plotWidth * index / denominator
            val y = bottom - plotHeight * value
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        canvas.drawPath(path, linePaint)
    }
}
