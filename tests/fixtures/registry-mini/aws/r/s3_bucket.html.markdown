---
subcategory: "S3"
---

# Resource: aws_s3_bucket

Provides an S3 bucket resource.

## Example Usage

```terraform
resource "aws_s3_bucket" "example" {
  bucket = "my-tf-test-bucket"
}
```

## Argument Reference

The following arguments are required:

* `bucket` - (Required) Name of the bucket.

The following arguments are optional:

* `force_destroy` - (Optional) Boolean.
* `tags` - (Optional) Map of tags.

## Import

```sh
terraform import aws_s3_bucket.example bucket-name
```
