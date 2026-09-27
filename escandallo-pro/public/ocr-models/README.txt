Modelos del lector de texto local de Escandallo Pro (se ejecutan en el navegador con ONNX Runtime Web; nada sale del
dispositivo).

  ppocrv5-mobile-det.onnx         PP-OCRv5_mobile_det (detección de texto, DB)
  ppocrv5-latin-mobile-rec.onnx   latin_PP-OCRv5_mobile_rec (reconocimiento de texto latino: tildes, ñ, ü, ç, €…)
  ppocrv5-latin-dict.txt          diccionario de caracteres del reconocedor (836 caracteres, uno por línea)

Origen: PaddleOCR (PaddlePaddle), modelos oficiales de inferencia en formato ONNX
  https://github.com/PaddlePaddle/PaddleOCR
  https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar
  https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/latin_PP-OCRv5_mobile_rec_onnx_infer.tar
El diccionario es la lista character_dict del inference.yml del reconocedor, sin cambios.

Licencia: Apache License 2.0 (ver LICENSE.txt). Copyright (c) PaddlePaddle Authors.

SHA-256:
  a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d  ppocrv5-mobile-det.onnx
  7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498  ppocrv5-latin-mobile-rec.onnx
