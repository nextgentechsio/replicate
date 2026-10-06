type Prediction = {
  status?: string;
  input?: Record<string, any>;
  output?: any;
  logs?: string;

  metrics?: {
    predict_time?: number;
    total_time?: number;
  };

  costUsd?: number;
  cost?: number;
};

/* =========================================================
   MODEL IDS
========================================================= */

export const MODEL_IDS = {
  NANO_BANANA: "google/nano-banana",

  NANO_BANANA_2:
    "google/nano-banana-2",

  NANO_BANANA_PRO:
    "google/nano-banana-pro",

  CRYSTAL_UPSCALER:
    "philz1337x/crystal-upscaler",

  KLING_V3_OMNI:
    "kwaivgi/kling-v3-omni-video",

  SEEDANCE_2:
    "bytedance/seedance-2.0",

  SEEDANCE_25:
    "bytedance/seedance-2.5",

  TOPAZ_IMAGE:
    "topazlabs/image-upscale",

  TOPAZ_VIDEO:
    "topazlabs/video-upscale",

  GPT_IMAGE_25_SUNBURST:
    "openai/gpt-image-2.5-sunburst",
} as const;


/* =========================================================
   HELPERS
========================================================= */

function numberValue(
  value: any,
  fallback = 0
): number {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function lower(
  value: any
): string {
  return String(
    value ?? ""
  )
    .trim()
    .toLowerCase();
}


function getInput(
  prediction: Prediction
): Record<string, any> {
  return (
    prediction?.input ?? {}
  );
}


function getResolution(
  input: Record<string, any>,
  fallback = ""
): string {
  return lower(
    input.resolution ??
      input.target_resolution ??
      input.output_resolution ??
      input.size ??
      fallback
  );
}


function getDuration(
  input: Record<string, any>,
  fallback = 5
): number {
  return numberValue(
    input.duration ??
      input.video_duration ??
      input.output_duration,
    fallback
  );
}


function hasVideoInput(
  input: Record<string, any>
): boolean {
  return Boolean(
    input.video ??
      input.video_input ??
      input.reference_video ??
      input.video_url
  );
}


function getQuality(
  input: Record<string, any>
): string {
  return lower(
    input.quality ??
      input.output_quality ??
      input.image_quality ??
      "auto"
  );
}


/* =========================================================
   GET OUTPUT MEGAPIXELS

   Used by:
   - Crystal Upscaler
   - Topaz Image
========================================================= */

function getOutputMegapixels(
  prediction: Prediction
): number {
  const input =
    getInput(prediction);

  /* -----------------------------------------
     Direct MP value
  ----------------------------------------- */

  let mp =
    numberValue(
      input.output_megapixels ??
        input.megapixels ??
        input.output_mp
    );

  if (mp > 0) {
    return mp;
  }


  /* -----------------------------------------
     Width × Height
  ----------------------------------------- */

  const width =
    numberValue(
      input.output_width ??
        input.width
    );

  const height =
    numberValue(
      input.output_height ??
        input.height
    );

  if (
    width > 0 &&
    height > 0
  ) {
    return (
      (width * height) /
      1_000_000
    );
  }


  /* -----------------------------------------
     Parse model logs

     Example:
     New upscaled resolution:
     1980x2466
  ----------------------------------------- */

  const logs =
    String(
      prediction.logs ?? ""
    );

  const resolutionMatch =
    logs.match(
      /(?:new upscaled resolution|upscaled resolution|output resolution)[^0-9]*(\d{2,6})\s*[x×]\s*(\d{2,6})/i
    );

  if (resolutionMatch) {
    const logWidth =
      Number(
        resolutionMatch[1]
      );

    const logHeight =
      Number(
        resolutionMatch[2]
      );

    if (
      logWidth > 0 &&
      logHeight > 0
    ) {
      return (
        (logWidth * logHeight) /
        1_000_000
      );
    }
  }


  /* -----------------------------------------
     Original dimensions × scale
  ----------------------------------------- */

  const originalWidth =
    numberValue(
      input.original_width
    );

  const originalHeight =
    numberValue(
      input.original_height
    );

  const scale =
    numberValue(
      input.scale_factor,
      2
    );

  if (
    originalWidth > 0 &&
    originalHeight > 0 &&
    scale > 0
  ) {
    return (
      (
        originalWidth *
        originalHeight *
        scale *
        scale
      ) /
      1_000_000
    );
  }


  return 0;
}


/* =========================================================
   DIRECT COST

   If Replicate/provider ever sends an exact cost,
   use that first.
========================================================= */

function getDirectCost(
  prediction: Prediction
): number | null {

  const candidates = [
    prediction?.costUsd,
    prediction?.cost,
    (prediction as any)?.metrics?.cost,
  ];

  for (
    const value of candidates
  ) {
    const cost =
      numberValue(
        value,
        -1
      );

    if (
      cost >= 0
    ) {
      return cost;
    }
  }

  return null;
}


/* =========================================================
   MAIN COST CALCULATOR
========================================================= */

export function calculateReplicateCost(
  model: string,
  prediction: Prediction
): number | null {

  if (!prediction) {
    return null;
  }


  /* -----------------------------------------
     Direct provider cost
  ----------------------------------------- */

  const directCost =
    getDirectCost(
      prediction
    );

  if (
    directCost !== null
  ) {
    return directCost;
  }


  /* -----------------------------------------
     Only completed predictions
  ----------------------------------------- */

  const status =
    lower(
      prediction.status
    );

  if (
    status !== "succeeded"
  ) {
    return null;
  }


  const input =
    getInput(
      prediction
    );

  const normalizedModel =
    lower(model);


/* =========================================================
   1. GOOGLE NANO BANANA
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.NANO_BANANA
  ) {

    /*
      Current Replicate price:

      $0.039 / output image
    */

    return 0.039;
  }


/* =========================================================
   2. GOOGLE NANO BANANA 2
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.NANO_BANANA_2
  ) {

    /*
      512px = $0.045
      1K    = $0.067
      2K    = $0.101
      4K    = $0.151
    */

    const resolution =
      getResolution(
        input,
        "1K"
      );


    if (
      resolution.includes(
        "512"
      )
    ) {
      return 0.045;
    }


    if (
      resolution.includes(
        "4k"
      )
    ) {
      return 0.151;
    }


    if (
      resolution.includes(
        "2k"
      )
    ) {
      return 0.101;
    }


    return 0.067;
  }


/* =========================================================
   3. GOOGLE NANO BANANA PRO
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.NANO_BANANA_PRO
  ) {

    /*
      1K       = $0.15
      2K       = $0.15
      4K       = $0.30
      fallback = $0.035
    */

    const resolution =
      getResolution(
        input,
        "2K"
      );


    if (
      resolution.includes(
        "fallback"
      )
    ) {
      return 0.035;
    }


    if (
      resolution.includes(
        "4k"
      )
    ) {
      return 0.30;
    }


    return 0.15;
  }


/* =========================================================
   4. CRYSTAL UPSCALER
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.CRYSTAL_UPSCALER
  ) {

    /*
      <= 4 MP     = $0.05
      <= 8 MP     = $0.10
      <= 16 MP    = $0.20
      <= 25 MP    = $0.40
      <= 50 MP    = $0.80
      <= 100 MP   = $1.60
      > 100 MP    = $3.20
    */

    const mp =
      getOutputMegapixels(
        prediction
      );


    /*
      Don't invent a price if the
      output size is genuinely unknown.
    */

    if (
      mp <= 0
    ) {
      return null;
    }


    if (
      mp <= 4
    ) {
      return 0.05;
    }


    if (
      mp <= 8
    ) {
      return 0.10;
    }


    if (
      mp <= 16
    ) {
      return 0.20;
    }


    if (
      mp <= 25
    ) {
      return 0.40;
    }


    if (
      mp <= 50
    ) {
      return 0.80;
    }


    if (
      mp <= 100
    ) {
      return 1.60;
    }


    return 3.20;
  }


/* =========================================================
   5. KLING V3 OMNI VIDEO
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.KLING_V3_OMNI
  ) {

    /*
      Standard no audio = $0.168/sec
      Standard audio    = $0.224/sec

      Pro no audio      = $0.224/sec
      Pro audio         = $0.28/sec

      4K                 = $0.42/sec
    */

    const duration =
      getDuration(
        input,
        5
      );


    const mode =
      lower(
        input.mode ??
          "standard"
      );


    const resolution =
      getResolution(
        input
      );


    const audio =
      Boolean(
        input.generate_audio ??
          input.audio
      );


    /*
      4K
    */

    if (
      mode.includes("4k") ||
      resolution.includes("4k") ||
      mode === "fourk"
    ) {
      return (
        duration *
        0.42
      );
    }


    /*
      Pro / 1080
    */

    if (
      mode === "pro" ||
      mode.includes("1080")
    ) {

      return (
        duration *
        (
          audio
            ? 0.28
            : 0.224
        )
      );
    }


    /*
      Standard
    */

    return (
      duration *
      (
        audio
          ? 0.224
          : 0.168
      )
    );
  }


/* =========================================================
   6. SEEDANCE 2.0
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.SEEDANCE_2
  ) {

    /*
      480p:
        video input    = $0.10/sec
        no video input = $0.08/sec

      720p:
        video input    = $0.22/sec
        no video input = $0.18/sec

      1080p:
        video input    = $0.55/sec
        no video input = $0.45/sec

      4K:
        video input    = $1.25/sec
        no video input = $1.00/sec
    */

    const duration =
      getDuration(
        input,
        5
      );


    const resolution =
      getResolution(
        input,
        "720p"
      );


    const videoIn =
      hasVideoInput(
        input
      );


    let rate: number;


    if (
      resolution.includes(
        "480"
      )
    ) {

      rate =
        videoIn
          ? 0.10
          : 0.08;

    } else if (
      resolution.includes(
        "1080"
      )
    ) {

      rate =
        videoIn
          ? 0.55
          : 0.45;

    } else if (
      resolution.includes(
        "4k"
      ) ||
      resolution.includes(
        "2160"
      )
    ) {

      rate =
        videoIn
          ? 1.25
          : 1.00;

    } else {

      rate =
        videoIn
          ? 0.22
          : 0.18;
    }


    return (
      duration *
      rate
    );
  }


/* =========================================================
   7. SEEDANCE 2.5
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.SEEDANCE_25
  ) {

    /*
      480p:
        video input    = $0.4304/sec
        no video input = $0.1028/sec

      720p:
        video input    = $0.9676/sec
        no video input = $0.2312/sec
    */

    const duration =
      getDuration(
        input,
        5
      );


    const resolution =
      getResolution(
        input,
        "720p"
      );


    const videoIn =
      hasVideoInput(
        input
      );


    if (
      resolution.includes(
        "480"
      )
    ) {

      return (
        duration *
        (
          videoIn
            ? 0.4304
            : 0.1028
        )
      );
    }


    if (
      resolution.includes(
        "720"
      )
    ) {

      return (
        duration *
        (
          videoIn
            ? 0.9676
            : 0.2312
        )
      );
    }


    /*
      Replicate currently publishes
      480p / 720p pricing here.

      Don't invent a 1080p / 4K rate.
    */

    return null;
  }


/* =========================================================
   8. TOPAZ IMAGE
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.TOPAZ_IMAGE
  ) {

    /*
      <= 24 MP  = $0.05
      <= 48 MP  = $0.10
      <= 60 MP  = $0.15
      <= 96 MP  = $0.20
      <= 132 MP = $0.24
      <= 168 MP = $0.29
      <= 336 MP = $0.53
      <= 512 MP = $0.82
    */

    const mp =
      getOutputMegapixels(
        prediction
      );


    if (
      mp <= 0
    ) {
      return null;
    }


    if (
      mp <= 24
    ) {
      return 0.05;
    }


    if (
      mp <= 48
    ) {
      return 0.10;
    }


    if (
      mp <= 60
    ) {
      return 0.15;
    }


    if (
      mp <= 96
    ) {
      return 0.20;
    }


    if (
      mp <= 132
    ) {
      return 0.24;
    }


    if (
      mp <= 168
    ) {
      return 0.29;
    }


    if (
      mp <= 336
    ) {
      return 0.53;
    }


    return 0.82;
  }


/* =========================================================
   9. TOPAZ VIDEO
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.TOPAZ_VIDEO
  ) {

    /*
      Published reference costs:

      720p -> 720p
      30fps = $0.027 / 5 sec
      60fps = $0.053 / 5 sec

      720p -> 1080p
      30fps = $0.093 / 5 sec
      60fps = $0.187 / 5 sec

      720p -> 4K
      30fps = $0.373 / 5 sec
      60fps = $0.747 / 5 sec
    */

    const duration =
      getDuration(
        input,
        5
      );


    const fps =
      numberValue(
        input.target_fps,
        30
      );


    const resolution =
      getResolution(
        input,
        "1080p"
      );


    let costPer5Seconds: number;


    /*
      720p
    */

    if (
      resolution.includes(
        "720"
      )
    ) {

      costPer5Seconds =
        fps > 30
          ? 0.053
          : 0.027;


    /*
      4K
    */

    } else if (
      resolution.includes(
        "4k"
      ) ||
      resolution.includes(
        "2160"
      )
    ) {

      costPer5Seconds =
        fps > 30
          ? 0.747
          : 0.373;


    /*
      1080p
    */

    } else {

      costPer5Seconds =
        fps > 30
          ? 0.187
          : 0.093;
    }


    return (
      costPer5Seconds *
      (duration / 5)
    );
  }


/* =========================================================
   10. GPT IMAGE 2.5 SUNBURST
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.GPT_IMAGE_25_SUNBURST
  ) {

    /*
      Replicate model-variant pricing:

      auto   = $0.25
      low    = $0.012
      medium = $0.047
      high   = $0.128
      xhigh  = $0.25
      max    = $0.50
    */

    const quality =
      getQuality(
        input
      );


    if (
      quality === "low"
    ) {
      return 0.012;
    }


    if (
      quality === "medium"
    ) {
      return 0.047;
    }


    if (
      quality === "high"
    ) {
      return 0.128;
    }


    if (
      quality === "xhigh"
    ) {
      return 0.25;
    }


    if (
      quality === "max"
    ) {
      return 0.50;
    }


    /*
      Replicate's auto variant
    */

    return 0.25;
  }


/* =========================================================
   UNKNOWN MODEL
========================================================= */

  /*
    Never fake a price.
  */

  return null;
}